import { v } from "convex/values"
import { action } from "./_generated/server"
import { requireRole } from "./lib/authz"
import {
  clearUmamiToken,
  getUmamiToken,
  readUmamiConfig,
  type UmamiConfig,
} from "./lib/umamiToken"

// Per-page statistics, read from a self-hosted Umami.
//
// An `action` and not a `query`, because it makes an outbound HTTP call and
// Convex queries cannot. The distinction matters beyond the type signature:
// a query is reactive and would re-run on every subscription tick, calling
// an external service the dashboard does not own once per render.
//
// The credentials live in this deployment's environment and never leave it.
// `PUBLIC_UMAMI_URL` and `PUBLIC_UMAMI_WEBSITE_ID` are public by design —
// they appear in the page source of every tracked site — but the username
// and password that *read* statistics are not, and the browser never sees
// them. That asymmetry is the whole reason this lives in Convex rather than
// being fetched from the admin app.

interface Stats {
  pageviews: number
  visitors: number
}

export interface AnalyticsResult {
  /** `null` whenever `status` is not `"ok"`. */
  last7: Stats | null
  last30: Stats | null
  /**
   * Why there are no numbers, when there are none. The dashboard renders
   * this instead of failing: a screen that breaks because a third-party
   * service is down is worse than a screen with no numbers on it.
   */
  status: "ok" | "not-configured" | "unreachable" | "unauthorized"
}

const DAY_MS = 24 * 60 * 60 * 1000

async function fetchStats(
  cfg: UmamiConfig,
  token: string,
  path: string,
  sinceMs: number,
  now: number
): Promise<{ stats: Stats | null; unauthorized: boolean }> {
  const params = new URLSearchParams({
    startAt: String(now - sinceMs),
    endAt: String(now),
    // Umami filters on the recorded URL path. Passing it is what makes this
    // per-page rather than site-wide — which is the point of showing it
    // beside one page's editor.
    url: path,
  })

  const response = await fetch(
    `${cfg.url}/api/websites/${cfg.websiteId}/stats?${params}`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
  )
  if (response.status === 401) return { stats: null, unauthorized: true }
  if (!response.ok) return { stats: null, unauthorized: false }

  // Umami wraps each metric as `{ value, prev }`. Only the current window is
  // surfaced: a comparison nobody asked for invites the wrong conclusion
  // from a short period.
  const body = (await response.json()) as {
    pageviews?: { value?: number }
    visitors?: { value?: number }
  }
  return {
    stats: {
      pageviews: body.pageviews?.value ?? 0,
      visitors: body.visitors?.value ?? 0,
    },
    unauthorized: false,
  }
}

export const forPath = action({
  args: { path: v.string() },
  handler: async (ctx, args): Promise<AnalyticsResult> => {
    // Statistics are readable by anyone who can edit what they measure —
    // and by nobody else. The role is re-checked here, as in every other
    // Convex function: the UI hides, it does not decide.
    await requireRole(ctx, ["owner", "admin", "editor"])

    const cfg = readUmamiConfig(process.env)
    // Not configured is an ordinary answer, not a failure: a template that
    // ships without analytics must not look broken to whoever adopts it.
    if (cfg === null) {
      return { last7: null, last30: null, status: "not-configured" }
    }

    const now = Date.now()

    try {
      let token = await getUmamiToken(cfg, now)
      if (token === null) {
        return { last7: null, last30: null, status: "unauthorized" }
      }

      let seven = await fetchStats(cfg, token, args.path, 7 * DAY_MS, now)
      if (seven.unauthorized) {
        // The cached token outlived its server-side session. Exactly one
        // retry after a fresh login: a loop here would replay the
        // credentials on every dashboard render.
        clearUmamiToken()
        token = await getUmamiToken(cfg, now)
        if (token === null) {
          return { last7: null, last30: null, status: "unauthorized" }
        }
        seven = await fetchStats(cfg, token, args.path, 7 * DAY_MS, now)
      }
      if (seven.stats === null) {
        return { last7: null, last30: null, status: "unreachable" }
      }

      const thirty = await fetchStats(cfg, token, args.path, 30 * DAY_MS, now)

      return {
        last7: seven.stats,
        // A 30-day window that fails while the 7-day one succeeded is not
        // worth failing the whole screen over: the shorter window is the
        // one being written against.
        last30: thirty.stats,
        status: "ok",
      }
    } catch {
      // A timeout, a DNS failure, a service that is down. The dashboard
      // reports "unreachable" and keeps working — statistics are
      // information, never a dependency of editing a page.
      return { last7: null, last30: null, status: "unreachable" }
    }
  },
})

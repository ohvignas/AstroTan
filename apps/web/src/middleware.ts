import type { MiddlewareHandler } from "astro"
import { api } from "@astrotan/backend/convex/_generated/api"
import { getConvexClient } from "./lib/convexClient"

// Redirects, resolved before any route runs.
//
// Running before the route is the whole point — an old URL must answer
// without its page existing — and it is also the danger: anything this
// swallows never reaches the page that would have served it. Which is why
// the guard against claiming a live path is at write time, in Convex, and
// not here.

interface Redirect {
  from: string
  to: string
  code: 301 | 302
}

const MEMO_TTL_MS = 60_000

let memo: { rows: Redirect[]; expiresAt: number } | null = null

/**
 * Drop the memo so the next request rereads Convex.
 *
 * Called by `/api/revalidate` when a publication invalidates the site. A
 * 60-second memo means a freshly minted 301 would otherwise stay invisible
 * for a minute — while the rest of the system propagates in seconds. This
 * is what keeps redirects on the same clock as everything else.
 */
export function purgeRedirectMemo(): void {
  memo = null
}

async function activeRedirects(): Promise<Redirect[]> {
  if (memo !== null && memo.expiresAt > Date.now()) return memo.rows
  const rows = (await getConvexClient().query(
    api.redirects.listActive,
    {}
  )) as Redirect[]
  memo = { rows, expiresAt: Date.now() + MEMO_TTL_MS }
  return rows
}

function normalize(pathname: string): string {
  return pathname.replace(/^\/+/, "").replace(/\/+$/, "")
}

export const onRequest: MiddlewareHandler = async (context, next) => {
  // A preview link must reach its page. Tokens sign the slug and a preview
  // opens at the article's real URL (`/tarifs?t=…`), so redirecting one
  // would break previewing a page whose slug just changed — which is
  // exactly when someone previews it.
  if (context.url.searchParams.has("t")) return next()

  // Endpoints answer for themselves; `/_image` is Astro's own optimiser and
  // must never be redirected, or every optimised image on the site breaks.
  const path = context.url.pathname
  if (path.startsWith("/api/") || path.startsWith("/_")) return next()

  const from = normalize(path)
  if (from.length === 0) return next()

  const match = (await activeRedirects()).find((row) => row.from === from)
  if (match === undefined) return next()

  return context.redirect(match.to, match.code)
}

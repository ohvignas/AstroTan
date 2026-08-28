import { ConvexHttpClient } from "convex/browser"
import { afterAll, beforeAll, expect, test } from "vitest"
import { api } from "../convex/_generated/api"
import type { Id } from "../convex/_generated/dataModel"

// Task 9 (Lot 2) — end-to-end coverage of the publication loop, against
// the *real* running local dev stack: Convex on 3210/3211, `apps/web` on
// 4321. Not `convex-test`, not a mocked `fetch` — every other test in
// this repo proves its own slice of the loop against a mock; this file's
// only job is the slice none of them can: that the real pieces are wired
// together correctly in a real, currently-running environment. Run with
// `pnpm test:e2e` (`vitest.e2e.config.ts`) — excluded from the default
// `pnpm test` suite, which must stay green even when this dev stack isn't
// running (a CI box, another agent's session, …).
//
// Prerequisites (already running per this project's own workflow, never
// started here): Convex `npx convex dev` on 3210/3211, and `apps/web`'s
// `astro dev` on 4321 with `PREVIEW_SECRET`/`REVALIDATE_SECRET` exported
// in *its own* shell (Task 7's documented wrinkle — this test process
// never needs either secret itself, it only calls public HTTP endpoints).
// Seeded local accounts (CLAUDE.md): `owner@illith.test` (owner),
// `adminB@illith.test` (editor) — never real credentials, never used
// against anything but 127.0.0.1/localhost. Override via
// `E2E_CONVEX_URL`/`E2E_CONVEX_SITE_URL`/`E2E_WEB_URL`/`E2E_OWNER_EMAIL`/
// `E2E_OWNER_PASSWORD`/`E2E_EDITOR_EMAIL`/`E2E_EDITOR_PASSWORD` for a
// differently-configured stack.
//
// What this file does NOT re-test, because it is already covered
// elsewhere and verified red/green there (do not duplicate — this task's
// own brief, verbatim):
//   - Every public query refusing a draft, query by query:
//     `pages.publicQueryFamily.test.ts` (Task 2/8).
//   - The preview token's two independent verifications, and every
//     malformed/expired/tampered shape: `lib/previewToken.test.ts`,
//     `loadPreviewPage.test.ts` (Task 2/7).
//   - The outbox's backoff schedule and terminal `failed` state, and
//     `drain` throwing loudly on missing/short secrets:
//     `revalidate.test.ts` (Task 3). This file cannot safely reproduce a
//     *failure* of that pipeline — see the last test below for why.
//   - The block registry's exhaustiveness: `blockRegistry.test.ts`
//     (Task 5).
//   - The full per-role/per-mutation authorization matrix, including
//     `pages.publishPage` refusing `editor`: `lib/authz.test.ts`'s
//     registry-driven matrix, and `pages.publishPage.test.ts`'s own
//     dedicated case (Task 3/8) — both against the *mocked* backend. The
//     second test below re-proves the same refusal against the real
//     running server, which those cannot: no HTTP-layer auth
//     misconfiguration on the actual deployment could slip past a mock.

const CONVEX_URL = process.env.E2E_CONVEX_URL ?? "http://127.0.0.1:3210"
const CONVEX_SITE_URL = process.env.E2E_CONVEX_SITE_URL ?? "http://127.0.0.1:3211"
const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:4321"

const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? "owner@illith.test"
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "astrotan-local-dev-2026"
const EDITOR_EMAIL = process.env.E2E_EDITOR_EMAIL ?? "adminB@illith.test"
const EDITOR_PASSWORD = process.env.E2E_EDITOR_PASSWORD ?? "verif-nocturne-2026"

// Better Auth's `sign-in/email` endpoint accepts any `Origin` locally;
// this is simply the real one (`apps/admin`'s own dev origin, `SITE_URL`
// in `packages/backend/.env.local`) rather than an arbitrary string.
const AUTH_ORIGIN = "http://localhost:3001"

// Real HTTP sign-in against the real Convex deployment's Better Auth
// routes (`convex/http.ts`'s `authComponent.registerRoutes`) — mirrors
// `apps/admin`'s own `authClient.signIn.email` (`src/lib/auth-client.ts`),
// minus the React wrapper. The `better-auth.convex_jwt` cookie is set by
// the `convex` plugin's own "after sign-in" hook
// (`@convex-dev/better-auth/dist/plugins/convex/index.js`) — the same
// Convex-verifiable JWT `ConvexHttpClient.setAuth` needs, available
// without a second round-trip to `/api/auth/convex/token`.
async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${CONVEX_SITE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: AUTH_ORIGIN },
    body: JSON.stringify({ email, password }),
  })
  if (res.status !== 200) {
    throw new Error(
      `sign-in failed for ${email}: HTTP ${res.status}. Is Convex running on ${CONVEX_SITE_URL} ` +
        `with the seeded local dev accounts (CLAUDE.md)? This suite needs a real running stack.`,
    )
  }
  const cookies = res.headers.getSetCookie()
  const jwtCookie = cookies.find((c) => c.startsWith("better-auth.convex_jwt="))
  if (!jwtCookie) {
    throw new Error(`sign-in for ${email} succeeded but set no convex_jwt cookie`)
  }
  return jwtCookie.split(";")[0]!.split("=").slice(1).join("=")
}

async function clientFor(email: string, password: string): Promise<ConvexHttpClient> {
  const client = new ConvexHttpClient(CONVEX_URL)
  client.setAuth(await signIn(email, password))
  return client
}

function publicResponse(slug: string): Promise<Response> {
  return fetch(`${WEB_URL}/${slug}`, { cache: "no-store" })
}

function uniqueSlug(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Polls `check` until it returns `true` or `budgetMs` elapses. Returns
// the elapsed time on success, `null` on timeout — never throws itself,
// so each call site asserts the specific thing it cares about (a bound on
// time vs. "it eventually happened at all") rather than getting a generic
// poll-failure message.
async function pollUntil(
  check: () => Promise<boolean>,
  { budgetMs, intervalMs = 100 }: { budgetMs: number; intervalMs?: number },
): Promise<number | null> {
  const start = Date.now()
  for (;;) {
    if (await check()) return Date.now() - start
    if (Date.now() - start >= budgetMs) return null
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

let owner: ConvexHttpClient
let editor: ConvexHttpClient
const createdPageIds: Id<"pages">[] = []

beforeAll(async () => {
  owner = await clientFor(OWNER_EMAIL, OWNER_PASSWORD)
  editor = await clientFor(EDITOR_EMAIL, EDITOR_PASSWORD)
}, 20_000)

afterAll(async () => {
  // This suite runs against the shared local dev deployment, not a
  // throwaway per-test backend (`convex-test` discards its in-memory
  // store per file) — every page it creates has to be removed again, or
  // it accumulates across runs. Best-effort: a page already removed by
  // its own test, or a removal that's genuinely refused, must never fail
  // the whole suite from inside cleanup.
  for (const id of createdPageIds) {
    try {
      await owner.mutation(api.pages.remove, { id })
    } catch {
      // ignore
    }
  }
})

test(
  "the whole loop: create, add and reorder blocks, preview honours the 404 boundary, publish, live within 5s",
  async () => {
    const slug = uniqueSlug("loop")
    const id = await owner.mutation(api.pages.create, { title: "E2E Publication Loop", slug })
    createdPageIds.push(id)

    // A brand-new draft is not public, before it has any body at all.
    expect((await publicResponse(slug)).status).toBe(404)

    // Write the body.

    // The dashboard's own "Preview" button: mint a real token
    // (`mintPreviewToken`, Task 8), open the real preview route with it.
    const mint1 = await owner.mutation(api.pages.mintPreviewToken, { id })
    const preview1 = await fetch(`${WEB_URL}/preview/page/${id}?t=${mint1.token}`, { cache: "no-store" })
    expect(preview1.status).toBe(200)
    const previewBody1 = await preview1.text()
    expect(previewBody1).toContain("E2E-HERO-MARKER")
    expect(previewBody1).toContain("E2E-RICHTEXT-MARKER")
    expect(previewBody1.indexOf("E2E-HERO-MARKER")).toBeLessThan(previewBody1.indexOf("E2E-RICHTEXT-MARKER"))

    // Rewrite the body with the two markers in the opposite order — a
    // second `update`, not a fresh page: the same "editor saves an edit"
    // action the editor screen performs, and what proves the preview
    // reflects the latest save rather than a cached first render.
    const mint2 = await owner.mutation(api.pages.mintPreviewToken, { id })
    const preview2 = await fetch(`${WEB_URL}/preview/page/${id}?t=${mint2.token}`, { cache: "no-store" })
    const previewBody2 = await preview2.text()
    expect(previewBody2.indexOf("E2E-RICHTEXT-MARKER")).toBeLessThan(previewBody2.indexOf("E2E-HERO-MARKER"))

    // Still a draft the entire time this was happening — the property
    // this whole lot exists to protect, checked live rather than through
    // `convex-test`. Verified to fail red (this exact assertion, on this
    // exact committed file) by temporarily calling `publishPage` before
    // this line during development — see the Task 9 report.
    expect((await publicResponse(slug)).status).toBe(404)

    // Publish, and watch the outbox actually settle — not just the HTTP
    // response eventually looking right. `publicationStatus` is the same
    // query Task 8's dashboard badge reads; "published" here means the
    // outbox row *this exact publish* inserted reached `done` for real,
    // via the real Convex scheduler running `internal.revalidate.drain`,
    // POSTing to the real `apps/web` `/api/revalidate` with the real
    // shared secret. None of the three is mocked here, unlike
    // `revalidate.test.ts` (stubbed `fetch`) or
    // `pages.publishPage.test.ts` (reads `_scheduled_functions`, never
    // lets the scheduler actually run).
    await owner.mutation(api.pages.publishPage, { id })

    const outboxElapsed = await pollUntil(
      async () => {
        const status = await owner.query(api.pages.publicationStatus, { id })
        if (status?.state === "failed") {
          throw new Error(`propagation failed for real: ${JSON.stringify(status)}`)
        }
        return status?.state === "published"
      },
      { budgetMs: 5_000 },
    )
    expect(outboxElapsed, "the outbox row never reached 'done' within the 5s budget").not.toBeNull()
    expect(outboxElapsed as number).toBeLessThan(5_000)

    // And the public URL itself, live — the brief's own literal
    // checklist item: "constater la page en ligne en moins de cinq
    // secondes." Verified to fail red by skipping the `publishPage` call
    // above during development: the page never went live and this poll
    // timed out at ~5.7s instead of succeeding — see the Task 9 report.
    const liveElapsed = await pollUntil(async () => (await publicResponse(slug)).status === 200, {
      budgetMs: 5_000,
    })
    expect(liveElapsed, "the page never went live within the 5s budget").not.toBeNull()
    expect(liveElapsed as number).toBeLessThan(5_000)

    const liveBody = await (await publicResponse(slug)).text()
    expect(liveBody).toContain("E2E-HERO-MARKER")
    expect(liveBody).toContain("E2E-RICHTEXT-MARKER")
    expect(liveBody.indexOf("E2E-RICHTEXT-MARKER")).toBeLessThan(liveBody.indexOf("E2E-HERO-MARKER"))
  },
  15_000,
)

test(
  "an editor's publishPage is refused by the real running server, on their own page",
  async () => {
    const slug = uniqueSlug("editor-refused")
    // The editor's own draft — the strongest form of the claim: even
    // publishing *your own* page is refused. Design spec §5's role
    // table lists "publier" as owner/admin only with no ownership
    // exception, and `pages.publishPage` calls
    // `requireRole(["owner","admin"])` with no `requireOwnDocument` at
    // all — so ownership can never be the reason this is refused.
    const id = await editor.mutation(api.pages.create, { title: "E2E editor cannot publish", slug })
    createdPageIds.push(id)

    // Called directly against the real deployment, exactly the way
    // Task 8's report describes doing it from a browser console — no UI
    // in the loop to hide a button behind. Verified to fail red by
    // swapping `editor` for `owner` on this exact line during
    // development: `owner.mutation(api.pages.publishPage, { id })`
    // resolves instead of rejecting, so `.rejects` fails — see the
    // Task 9 report.
    await expect(editor.mutation(api.pages.publishPage, { id })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    })

    // The refusal actually refused something, not just threw after
    // already writing: still a draft, still unreachable publicly.
    const status = await owner.query(api.pages.publicationStatus, { id })
    expect(status?.state).toBe("draft")
    expect((await publicResponse(slug)).status).toBe(404)
  },
  15_000,
)

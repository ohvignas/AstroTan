// The two-barrier authorization logic behind `src/pages/preview/[type]/[id].astro`,
// pulled out of that route file for one reason: Astro's Container API
// (`astro/container`, still `experimental_` as of Astro 7.2.8) has no way
// to exercise `context.cache` in a test — its lightweight render pipeline
// never runs the cache-provisioning middleware the real dev/build server
// does (`astro/dist/core/cache/handler.js`'s `provideCache`/`handleCache`,
// wired into the real request pipeline, never called from
// `container/index.js`'s own `renderToResponse`) — so `Astro.cache.set(false)`,
// the very first line that route file runs, throws
// `Cannot read properties of undefined (reading 'set')` the moment any
// test tries to render it through the Container. That single line has
// nothing to do with *this* module's job (deciding whether a preview
// request is authorized at all), so this file carries that job alone,
// testable directly with plain function calls and no Astro rendering
// pipeline involved — `loadPreviewPage.test.ts` does exactly that. The
// route file itself stays a thin wrapper: call this, set the
// cache/response-header properties Astro requires, render.
//
// Design spec §6.3, "deux barrières indépendantes" — both live here:
//   1. `verifyPreviewToken` (`./previewToken.ts`), entirely local, no
//      network call reachable unless it returns `true`.
//   2. `previewPage` (`packages/backend/convex/pages.ts`), Convex's own
//      independent re-verification of the identical HMAC — never skipped
//      just because barrier 1 already passed.
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { getConvexClient } from "./convexClient"
import { verifyPreviewToken } from "./previewToken"

// Mirrors `PREVIEW_TOKEN_TYPE` in `packages/backend/convex/pages.ts` — the
// only literal a real page-preview token is ever signed for. This route
// (and this app) has no wiring for any other `type`, so anything else is
// refused before `id`/`token` are even inspected — the "refuse any input
// shape you cannot interpret" rule this task's own brief calls out.
const PREVIEW_TOKEN_TYPE = "page"

export async function loadPreviewPage(params: {
  type: string | undefined
  id: string | undefined
  token: string | null
}) {
  const { type, id, token } = params

  // Barrier 1 — a single boolean built up left to right so every clause
  // short-circuits the next: `verifyPreviewToken` is only ever reached
  // once `type`/`id`/`token` are all present and shaped as expected.
  const locallyAuthorized =
    type === PREVIEW_TOKEN_TYPE &&
    id !== undefined &&
    token !== null &&
    verifyPreviewToken({ type, id, token })

  if (!locallyAuthorized) return null

  // Barrier 2 — only reachable once barrier 1 above is `true`.
  // `previewPage` re-verifies the identical HMAC independently, against
  // Convex's own `PREVIEW_SECRET` (`packages/backend/convex/lib/previewToken.ts`),
  // never trusting that barrier 1 already passing makes this call itself
  // optional. A thrown `ConvexError({ code: "INVALID_PREVIEW_TOKEN" })`
  // (Convex's own independent "no"), any other thrown error (a network
  // failure, a malformed `id` Convex's own validator rejects outright),
  // and an explicit `null` all collapse to the same `null` returned here —
  // never a distinguishable error surfaced to the caller.
  //
  // `id as Id<"pages">`/`token as string`: the `locallyAuthorized` guard
  // above already proves both are defined at runtime, but TypeScript
  // can't re-derive that narrowing through a separately-named boolean —
  // these casts are what a raw route-param id/token always needs at this
  // boundary, the same idiom `apps/admin` uses for ids read off its own
  // routes/state (`src/routes/_authed/users.tsx`).
  return getConvexClient()
    .query(api.pages.previewPage, { id: id as Id<"pages">, token: token as string })
    .catch(() => null)
}

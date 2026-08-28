// Lot 2, Task 7; design spec §6.2 — the last hop of the publication loop.
// `convex/revalidate.ts`'s `drain` action POSTs here for every due outbox
// row, `x-revalidate-secret: process.env.REVALIDATE_SECRET` read on that
// side (see that file's own header for why `WEB_SITE_URL` — the origin
// `drain` POSTs to — is a deliberately different env var from `SITE_URL`).
// This route is the only thing standing between "anyone on the internet
// can purge this app's whole cache for free" and "only whoever holds the
// shared secret can" — every property below is load-bearing, not
// defensive polish.
//
// `output: 'static'` (astro.config.ts) prerenders by default; this route
// opts out explicitly, the same documented pattern `[...slug].astro`
// already follows ("the opt-out is the explicit call, not an absence of a
// `routeRules` entry").
export const prerender = false

import type { APIRoute } from "astro"
import { timingSafeEqual } from "node:crypto"

// Same floor as `PREVIEW_SECRET`'s own guard (`../../lib/previewToken.ts`)
// and Convex's copy (`packages/backend/convex/revalidate.ts`): an
// HMAC-strength secret shorter than 32 characters is not a real key.
const MIN_REVALIDATE_SECRET_LENGTH = 32

// Read inside the handler, not cached at module load — a deployment
// missing this var is a configuration error and must throw (visible as a
// 500, surfaced loudly) rather than let every request silently fall
// through to "refused", indistinguishable from the outside from "every
// caller happens to send the wrong secret forever".
function getRevalidateSecret(): string {
  const secret = process.env.REVALIDATE_SECRET
  if (!secret) {
    throw new Error("REVALIDATE_SECRET is not set on this Astro deployment")
  }
  if (secret.length < MIN_REVALIDATE_SECRET_LENGTH) {
    throw new Error(`REVALIDATE_SECRET must be at least ${MIN_REVALIDATE_SECRET_LENGTH} characters`)
  }
  return secret
}

// This task's brief, verbatim: "a wrong, missing, or wrong-length secret
// must be refused identically — do not let the refusal distinguish them."
// Two separate properties, both handled here:
//
//   1. The *comparison* must not leak the secret's content through
//      timing. `node:crypto`'s `timingSafeEqual` is a real constant-time
//      primitive — not a `===`, which would short-circuit on the first
//      differing byte and leak how many leading bytes matched through how
//      long the compare takes.
//   2. Every failure *reason* must produce the exact same response.
//      `provided` is coerced to `""` when the header is absent (call
//      site, `?? ""`) rather than special-cased before ever reaching this
//      function — "missing" and "present but wrong" take the identical
//      code path here. And `timingSafeEqual` itself throws on
//      unequal-length buffers rather than comparing them, which is
//      exactly the kind of response-shape leak (a caught exception vs. a
//      clean `false`) this task's brief is warning about — a "wrong
//      length" secret must come back as an ordinary `false`, not a
//      different code path with a different failure mode. The length
//      check below exists for that reason, not as an optimization.
function isValidSecret(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"))
}

// `tags` is read once, here, and the exact same value is what `POST`
// below passes to `cache.invalidate` — there is no separate "validate the
// shape" pass and "read the value to act on" pass that could ever
// disagree about what was actually checked (the trap this task's brief
// names explicitly: a guard reading a field the endpoint later coerces
// differently). Anything that isn't precisely `{ tags: string[] }` —
// including a body that isn't valid JSON, isn't an object, or has a
// `tags` field of the wrong shape — is refused, not coerced to `[]` and
// let through to a 200 that silently invalidated nothing.
function extractTags(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null) return null
  if (!("tags" in body)) return null
  const { tags } = body as { tags: unknown }
  if (!Array.isArray(tags)) return null
  if (!tags.every((tag) => typeof tag === "string")) return null
  return tags
}

// No `GET`/`ALL` export exists in this module at all — not merely unused.
// Astro's own endpoint runtime (`renderEndpoint`,
// `astro/dist/runtime/server/endpoint.js`) responds 404 to any method
// with no matching handler; verified by reading that source directly
// (`let handler = mod[method] ?? mod["ALL"]; ... if (handler === void 0)
// ... return new Response(null, { status: 404 })`) and exercised by this
// file's own test, not merely assumed from the docs.
export const POST: APIRoute = async (context) => {
  // Never cacheable — set first, unconditionally, before the secret check
  // below has any chance to return early: astro.config.ts's own comment
  // is explicit that the opt-out is this call, not a `routeRules` entry
  // (and `/api/revalidate` has no entry there to inherit from regardless).
  context.cache.set(false)

  const expected = getRevalidateSecret()
  const provided = context.request.headers.get("x-revalidate-secret") ?? ""
  if (!isValidSecret(provided, expected)) {
    return new Response(null, { status: 401 })
  }

  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return new Response(null, { status: 400 })
  }

  const tags = extractTags(body)
  if (tags === null) {
    return new Response(null, { status: 400 })
  }

  await context.cache.invalidate({ tags })
  return new Response(null, { status: 200 })
}

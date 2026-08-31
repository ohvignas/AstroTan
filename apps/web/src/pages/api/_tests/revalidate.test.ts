// This file lives under `_tests/` rather than next to `revalidate.ts` for a
// mechanical reason, not an aesthetic one: `src/pages/**` is Astro's route
// tree, and a `.ts` sitting in it is compiled as a route. At
// `src/pages/api/revalidate.test.ts` this file became the route
// `/api/revalidate.test`, pulled `vitest` into the prerender bundle, and
// failed `astro build` with "Vitest failed to find the runner" — tests
// green, typecheck clean, and the site image impossible to build. Astro
// excludes from routing any file or directory under `src/pages` prefixed
// with `_`; this directory is that exclusion. Do not move this file up one
// level.

import { experimental_AstroContainer as AstroContainer } from "astro/container"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { APIContext } from "astro"
import { POST } from "../revalidate"
import * as revalidateEndpoint from "../revalidate"
import * as middleware from "../../../middleware"

const TEST_SECRET = "test-revalidate-secret-please-do-not-use-x"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.REVALIDATE_SECRET = TEST_SECRET
})

afterEach(() => {
  process.env = originalEnv
})

// `POST` is a plain `(context: APIContext) => Promise<Response>`. Astro's
// Container API (`astro/container`, still `experimental_` as of Astro
// 7.2.8) cannot exercise `context.cache` in a test — its lightweight
// render pipeline never runs the cache-provisioning middleware the real
// dev/build server does (confirmed by reading
// `astro/dist/core/cache/handler.js` directly: `provideCache`/`handleCache`
// are wired into the real request pipeline, never called from
// `container/index.js`'s own `renderToResponse`) — so every test below
// that exercises the endpoint's own logic (secret comparison, body-shape
// validation, `cache.set`/`cache.invalidate` calls) calls `POST` directly
// against a hand-built `APIContext`, with `cache.set`/`cache.invalidate`
// as spies: this actually proves *more* than a Container-based render
// would have (it confirms the literal calls and arguments, not just "the
// route didn't throw"). Real confirmation that Astro's own cache
// machinery actually invalidates a tag end to end is done separately, by
// hand, against the running dev server + a real `publishPage` call (this
// task's own "verify by driving it" instruction).
function fakeContext(options: {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  rawBody?: string
}): { context: APIContext; cacheSet: ReturnType<typeof vi.fn>; cacheInvalidate: ReturnType<typeof vi.fn> } {
  const { method = "POST", headers = {}, body, rawBody } = options
  const request = new Request("http://localhost/api/revalidate", {
    method,
    headers,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  const cacheSet = vi.fn()
  const cacheInvalidate = vi.fn(async () => {})
  const context = { request, cache: { set: cacheSet, invalidate: cacheInvalidate } } as unknown as APIContext
  return { context, cacheSet, cacheInvalidate }
}

describe("POST /api/revalidate", () => {
  test("le bon secret avec un corps valide invalide le cache et répond 200", async () => {
    const pixel = vi.spyOn(middleware, "purgePixelMemo")
    const { context, cacheSet, cacheInvalidate } = fakeContext({
      headers: { "x-revalidate-secret": TEST_SECRET, "content-type": "application/json" },
      body: { tags: ["pages", "page:home"] },
    })

    const response = await POST(context)

    expect(response.status).toBe(200)
    // Explicit `context.cache.set(false)` in the route — this task's own
    // requirement, not a `routeRules` entry (astro.config.ts's comment).
    expect(cacheSet).toHaveBeenCalledWith(false)
    // The exact tags from the body, unmodified — the same value that was
    // validated is the value that was acted on.
    expect(cacheInvalidate).toHaveBeenCalledWith({ tags: ["pages", "page:home"] })
    expect(pixel).toHaveBeenCalled()
  })

  test("un secret manquant est refusé et n'invalide rien", async () => {
    const { context, cacheInvalidate } = fakeContext({ body: { tags: ["pages"] } })

    const response = await POST(context)

    expect(response.status).not.toBe(200)
    expect(cacheInvalidate).not.toHaveBeenCalled()
  })

  test("un mauvais secret (même longueur que le vrai) est refusé", async () => {
    const wrongSameLength = "x".repeat(TEST_SECRET.length)
    expect(wrongSameLength).not.toBe(TEST_SECRET)
    const { context, cacheInvalidate } = fakeContext({
      headers: { "x-revalidate-secret": wrongSameLength },
      body: { tags: ["pages"] },
    })

    const response = await POST(context)

    expect(response.status).not.toBe(200)
    expect(cacheInvalidate).not.toHaveBeenCalled()
  })

  test("un secret de mauvaise longueur est refusé sans lever d'exception", async () => {
    const { context, cacheInvalidate } = fakeContext({
      headers: { "x-revalidate-secret": "way-too-short" },
      body: { tags: ["pages"] },
    })

    await expect(POST(context)).resolves.toBeInstanceOf(Response)
    expect(cacheInvalidate).not.toHaveBeenCalled()
  })

  // M1 (whole-lot review): `isValidSecret` used to compare `.length` in
  // *characters* before comparing bytes with `timingSafeEqual`. Node
  // parses raw HTTP header bytes as latin1 — one JS string char per byte
  // — so a header value containing a code point in 0x80–0xFF is one JS
  // char but encodes to *two* UTF-8 bytes. A secret built that way can
  // have the same character length as the real secret while its
  // `Buffer.from(..., "utf8")` length differs, which made
  // `timingSafeEqual` throw `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` —
  // uncaught, surfacing as a 500 instead of the 401 every other wrong
  // secret gets. That 500-vs-401 split is itself the leak: probing with
  // `"\xe9" + "a".repeat(n-1)` for increasing `n` reveals the exact
  // secret length at the one `n` that 500s instead of 401s.
  test("un secret non-ASCII de même longueur en caractères que le vrai secret ne fait pas planter la comparaison", async () => {
    const nonAsciiSecret = "é" + "a".repeat(TEST_SECRET.length - 1)
    expect(nonAsciiSecret.length).toBe(TEST_SECRET.length)
    expect(nonAsciiSecret).not.toBe(TEST_SECRET)
    const { context, cacheInvalidate } = fakeContext({
      headers: { "x-revalidate-secret": nonAsciiSecret },
      body: { tags: ["pages"] },
    })

    const response = await POST(context)

    expect(response.status).toBe(401)
    expect(cacheInvalidate).not.toHaveBeenCalled()
  })

  // This task's brief, verbatim: "a wrong, missing, or wrong-length secret
  // must be refused identically — do not let the refusal distinguish
  // them." Not just "all three are non-200" (the three tests above) but
  // that the *response itself* — status and body — is indistinguishable
  // across all three failure reasons.
  //
  // Closing-fixes review: the non-ASCII case (M1, this same file's own
  // dedicated test above) belongs in this identity check too — it used to
  // live only in its own 401-only assertion, never proven identical to
  // the other three refusal shapes. Folded in here rather than left as a
  // separate claim.
  test("secret manquant, mauvais, ou de mauvaise longueur produisent la même réponse", async () => {
    const nonAsciiSecret = "é" + "a".repeat(TEST_SECRET.length - 1)
    const scenarios = [
      fakeContext({ body: { tags: ["pages"] } }), // missing
      fakeContext({
        headers: { "x-revalidate-secret": "x".repeat(TEST_SECRET.length) },
        body: { tags: ["pages"] },
      }), // wrong, same length
      fakeContext({ headers: { "x-revalidate-secret": "short" }, body: { tags: ["pages"] } }), // wrong length
      fakeContext({ headers: { "x-revalidate-secret": nonAsciiSecret }, body: { tags: ["pages"] } }), // non-ASCII, same char length (M1)
    ]

    const responses = await Promise.all(
      scenarios.map(async ({ context }) => {
        const response = await POST(context)
        return { status: response.status, body: await response.text() }
      }),
    )

    const [first, ...rest] = responses
    for (const response of rest) {
      expect(response).toEqual(first)
    }
    expect(first?.status).not.toBe(200)
  })

  test("un corps sans `tags` est refusé plutôt que silencieusement traité comme aucun tag", async () => {
    const { context, cacheInvalidate } = fakeContext({
      headers: { "x-revalidate-secret": TEST_SECRET },
      body: {},
    })

    const response = await POST(context)

    expect(response.status).not.toBe(200)
    expect(cacheInvalidate).not.toHaveBeenCalled()
  })

  test("un corps dont `tags` n'est pas un tableau de chaînes est refusé", async () => {
    const { context, cacheInvalidate } = fakeContext({
      headers: { "x-revalidate-secret": TEST_SECRET },
      body: { tags: [1, 2, 3] },
    })

    const response = await POST(context)

    expect(response.status).not.toBe(200)
    expect(cacheInvalidate).not.toHaveBeenCalled()
  })

  test("un corps JSON malformé est refusé", async () => {
    const { context, cacheInvalidate } = fakeContext({
      headers: { "x-revalidate-secret": TEST_SECRET, "content-type": "application/json" },
      rawBody: "{not json",
    })

    const response = await POST(context)

    expect(response.status).not.toBe(200)
    expect(cacheInvalidate).not.toHaveBeenCalled()
  })

  // The one behaviour that genuinely needs Astro's own request dispatch
  // (`renderEndpoint`, `astro/dist/runtime/server/endpoint.js`) rather
  // than a direct call to `POST` — a GET request never reaches `POST` at
  // all, so there is no `context.cache` involved and the Container's own
  // gap (see this file's header) doesn't apply here. `mod["GET"] ??
  // mod["ALL"]` is `undefined` (this module exports nothing but `POST`),
  // so Astro's own runtime returns 404 before calling any handler —
  // verified here, not just by reading that source.
  test("GET est refusé (Astro répond 404 : aucun handler exporté pour cette méthode)", async () => {
    const container = await AstroContainer.create()
    const request = new Request("http://localhost/api/revalidate", { method: "GET" })
    // `renderToResponse`'s own type signature (astro/dist/container/index.d.ts)
    // types its first parameter as `AstroComponentFactory` even for the
    // `routeType: "endpoint"` case its own doc comment documents
    // (`container.renderToString(Endpoint, { routeType: "endpoint" })`) —
    // an endpoint module namespace (exporting `POST`, not a component
    // factory) is exactly what that documented usage passes, so this is a
    // known looseness in that `.d.ts`, not a real type mismatch; the
    // runtime (`container/index.js`'s own `renderToResponse`) uses the
    // module object as-is whenever `routeType === "endpoint"`.
    const response = await container.renderToResponse(
      revalidateEndpoint as unknown as Parameters<typeof container.renderToResponse>[0],
      { routeType: "endpoint", request },
    )
    expect(response.status).toBe(404)
  })
})

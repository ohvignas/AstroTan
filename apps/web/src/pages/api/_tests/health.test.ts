import { describe, expect, test } from "vitest"
import type { APIContext } from "astro"
import { GET } from "../health"

// Un faux contexte minimal : `cache.set` est la seule chose que la route
// touche. On l'observe pour vérifier l'opt-out de cache, exactement comme
// `revalidate.test.ts` le fait pour son propre `context.cache.set(false)`.
function makeContext() {
  const calls: Array<boolean> = []
  const context = {
    cache: { set: (value: boolean) => calls.push(value) },
  } as unknown as APIContext
  return { context, calls }
}

describe("GET /api/health", () => {
  test("répond 200 sans toucher Convex", async () => {
    const { context } = makeContext()
    const response = await GET(context)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("ok")
  })

  test("n'est jamais mise en cache", async () => {
    const { context, calls } = makeContext()
    await GET(context)
    expect(calls).toEqual([false])
  })
})

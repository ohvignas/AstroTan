import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { APIContext } from "astro"

const query = vi.fn()
vi.mock("../../lib/convexClient", () => ({
  getConvexClient: () => ({ query }),
}))

let GET: typeof import("../logo").GET

function makeContext() {
  const calls: Array<boolean> = []
  const context = {
    cache: { set: (value: boolean) => calls.push(value) },
  } as unknown as APIContext
  return { context, calls }
}

describe("GET /logo", () => {
  beforeEach(async () => {
    query.mockReset()
    vi.unstubAllGlobals()
    ;({ GET } = await import("../logo"))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("404 sans logo téléversé, sans relayer Convex storage au client", async () => {
    query.mockResolvedValueOnce({ logoId: undefined })
    const { context, calls } = makeContext()
    const response = await GET(context)
    expect(response.status).toBe(404)
    expect(calls).toEqual([false])
    expect(query).toHaveBeenCalledTimes(1)
  })

  test("relaye les octets du logo, pas l'URL Convex", async () => {
    query
      .mockResolvedValueOnce({ logoId: "kg_logo" })
      .mockResolvedValueOnce("https://happy-animal.convex.cloud/api/storage/kg")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      })),
    )
    const { context } = makeContext()
    const response = await GET(context)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(await response.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer)
  })
})

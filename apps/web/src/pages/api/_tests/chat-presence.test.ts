import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { APIContext } from "astro"

const mutation = vi.fn()
const query = vi.fn()
vi.mock("../../../lib/convexClient", () => ({
  getConvexClient: () => ({ mutation, query }),
}))

let POST: typeof import("../chat/presence").POST

const SECRET = "un-secret-partage-de-plus-de-32-caracteres"

function fakeContext(body: unknown): APIContext {
  const request = new Request("http://localhost/api/chat/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return { request, clientAddress: "203.0.113.42" } as unknown as APIContext
}

let originalEnv: NodeJS.ProcessEnv

beforeEach(async () => {
  vi.resetModules()
  mutation.mockReset()
  query.mockReset()
  mutation.mockResolvedValue({ staffOnline: false })
  originalEnv = { ...process.env }
  process.env.LEAD_SUBMIT_SECRET = SECRET
  process.env.CHAT_SESSION_SECRET = SECRET
  const mod = await import("../chat/presence")
  POST = mod.POST
})

afterEach(() => {
  process.env = originalEnv
  vi.restoreAllMocks()
})

describe("POST /api/chat/presence", () => {
  test("sans secret configuré, 503 et aucun appel Convex", async () => {
    delete process.env.LEAD_SUBMIT_SECRET
    vi.resetModules()
    const mod = await import("../chat/presence")
    const response = await mod.POST(fakeContext({ token: "x" }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: "indisponible" })
    expect(mutation).not.toHaveBeenCalled()
  })

  test("un pot de miel rempli répond { ok: true } sans appeler Convex", async () => {
    const response = await POST(fakeContext({ token: "x", site_web: "https://spam.test" }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(mutation).not.toHaveBeenCalled()
  })
})

// Vit sous `_tests/` pour la même raison que `consent.test.ts` et
// `revalidate.test.ts` : un `.ts` posé à `api/chat/start.test.ts` devient
// la route `/api/chat/start.test`, tire Vitest dans le bundle et casse
// `astro build`. Astro exclut tout préfixe `_` sous `src/pages`.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { APIContext } from "astro"

const mutation = vi.fn()
const query = vi.fn()
vi.mock("../../../lib/convexClient", () => ({
  getConvexClient: () => ({ mutation, query }),
}))

let POST: typeof import("../chat/start").POST

const SECRET = "un-secret-partage-de-plus-de-32-caracteres"

function fakeContext(options: { body?: unknown; clientAddress?: string }): APIContext {
  const { body, clientAddress = "203.0.113.42" } = options
  const request = new Request("http://localhost/api/chat/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { request, clientAddress } as unknown as APIContext
}

async function jsonOf(response: Response): Promise<unknown> {
  return response.json()
}

let originalEnv: NodeJS.ProcessEnv

beforeEach(async () => {
  vi.resetModules()
  mutation.mockReset()
  query.mockReset()
  mutation.mockResolvedValue({
    token: "jeton-de-test",
    leadId: "lead_1",
    threadId: "thread_1",
    expiresAt: Date.now() + 60_000,
  })
  originalEnv = { ...process.env }
  process.env.LEAD_SUBMIT_SECRET = SECRET
  process.env.CHAT_SESSION_SECRET = SECRET
  const mod = await import("../chat/start")
  POST = mod.POST
})

afterEach(() => {
  process.env = originalEnv
  vi.restoreAllMocks()
})

describe("POST /api/chat/start", () => {
  test("sans secret configuré, la route répond 503 { code: indisponible } et n'appelle jamais Convex", async () => {
    delete process.env.LEAD_SUBMIT_SECRET
    vi.resetModules()
    const mod = await import("../chat/start")

    const response = await mod.POST(fakeContext({ body: { email: "a@exemple.fr" } }))

    expect(response.status).toBe(503)
    expect(await jsonOf(response)).toEqual({ code: "indisponible" })
    expect(mutation).not.toHaveBeenCalled()
  })

  test("avec e-mail, transmet quand même l'IP et le pays — l'e-mail ne skip pas l'IP", async () => {
    const request = new Request("http://localhost/api/chat/start", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-ipcountry": "FR" },
      body: JSON.stringify({ email: "ada@exemple.fr", name: "Ada" }),
    })
    const response = await POST({
      request,
      clientAddress: "203.0.113.42",
    } as unknown as APIContext)

    expect(response.status).toBe(200)
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        email: "ada@exemple.fr",
        ip: "203.0.113.42",
        country: "FR",
      }),
    )
  })

  test("transmet l'IP de confiance à start", async () => {
    const request = new Request("http://localhost/api/chat/start", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-ipcountry": "FR" },
      body: JSON.stringify({}),
    })
    const response = await POST({
      request,
      clientAddress: "203.0.113.42",
    } as unknown as APIContext)

    expect(response.status).toBe(200)
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ip: "203.0.113.42",
        country: "FR",
      }),
    )
  })

  test("sans e-mail, la mutation part sans champ email", async () => {
    const response = await POST(fakeContext({ body: {} }))

    expect(response.status).toBe(200)
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ email: expect.anything() }),
    )
  })

  test("un pot de miel rempli répond { ok: true } sans appeler Convex", async () => {
    const response = await POST(
      fakeContext({ body: { email: "bot@exemple.fr", site_web: "https://spam.test" } }),
    )

    expect(response.status).toBe(200)
    expect(await jsonOf(response)).toEqual({ ok: true })
    expect(mutation).not.toHaveBeenCalled()
  })
})

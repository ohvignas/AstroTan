import { createHmac } from "node:crypto"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { APIContext } from "astro"

const mutation = vi.fn()
const query = vi.fn()
vi.mock("../../../lib/convexClient", () => ({
  getConvexClient: () => ({ mutation, query }),
}))

let POST: typeof import("../chat/email").POST

const SECRET = "un-secret-partage-de-plus-de-32-caracteres"

function signToken(): string {
  const expiresAt = Date.now() + 60_000
  const leadId = Buffer.from("lead_1").toString("base64url")
  const threadId = Buffer.from("thread_1").toString("base64url")
  const signature = createHmac("sha256", SECRET)
    .update(`chatSession:lead_1:thread_1:${expiresAt}`)
    .digest("hex")
  return `${expiresAt}.${leadId}.${threadId}.${signature}`
}

function fakeContext(options: { body?: unknown; clientAddress?: string }): APIContext {
  const { body, clientAddress = "203.0.113.42" } = options
  const request = new Request("http://localhost/api/chat/email", {
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
  mutation.mockResolvedValue({ leadId: "lead_1" })
  originalEnv = { ...process.env }
  process.env.LEAD_SUBMIT_SECRET = SECRET
  process.env.CHAT_SESSION_SECRET = SECRET
  const mod = await import("../chat/email")
  POST = mod.POST
})

afterEach(() => {
  process.env = originalEnv
  vi.restoreAllMocks()
})

describe("POST /api/chat/email", () => {
  test("transmet l'IP de confiance et le pays Cloudflare à attachEmail", async () => {
    const request = new Request("http://localhost/api/chat/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-ipcountry": "FR",
        "cf-ipcity": "Lyon",
      },
      body: JSON.stringify({ token: signToken(), email: "ada@exemple.fr" }),
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
        city: "Lyon",
      }),
    )
  })

  test("un pot de miel rempli répond { ok: true } sans appeler Convex", async () => {
    const response = await POST(
      fakeContext({
        body: { token: "jeton", email: "bot@exemple.fr", site_web: "https://spam.test" },
      }),
    )

    expect(response.status).toBe(200)
    expect(await jsonOf(response)).toEqual({ ok: true })
    expect(mutation).not.toHaveBeenCalled()
  })
})

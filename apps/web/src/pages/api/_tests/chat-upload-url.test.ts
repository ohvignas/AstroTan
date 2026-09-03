import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createHmac } from "node:crypto"
import type { APIContext } from "astro"

const mutation = vi.fn()
const query = vi.fn()
vi.mock("../../../lib/convexClient", () => ({
  getConvexClient: () => ({ mutation, query }),
}))

let POST: typeof import("../chat/upload-url").POST

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

function fakeContext(body: unknown): APIContext {
  const request = new Request("http://localhost/api/chat/upload-url", {
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
  mutation.mockResolvedValue("https://upload.example/tmp")
  originalEnv = { ...process.env }
  process.env.LEAD_SUBMIT_SECRET = SECRET
  process.env.CHAT_SESSION_SECRET = SECRET
  const mod = await import("../chat/upload-url")
  POST = mod.POST
})

afterEach(() => {
  process.env = originalEnv
  vi.restoreAllMocks()
})

describe("POST /api/chat/upload-url", () => {
  test("sans jeton répond session et n'appelle pas Convex", async () => {
    const response = await POST(fakeContext({ token: "" }))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: "session" })
    expect(mutation).not.toHaveBeenCalled()
  })

  test("avec jeton demande une URL d'upload au backend", async () => {
    const token = signToken()
    const response = await POST(fakeContext({ token }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      uploadUrl: "https://upload.example/tmp",
    })
    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      secret: SECRET,
      token,
    })
  })
})

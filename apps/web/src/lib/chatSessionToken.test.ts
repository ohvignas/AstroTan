import { createHmac } from "node:crypto"
import { afterEach, beforeEach, expect, test } from "vitest"
import { verifyChatSessionToken } from "./chatSessionToken"

const SECRET = "test-chat-session-secret-please-do-not-use-x"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.CHAT_SESSION_SECRET = SECRET
})

afterEach(() => {
  process.env = originalEnv
})

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

function signTestToken(
  leadId: string,
  threadId: string,
  expiresAt: number,
  secret = SECRET,
): string {
  const message = `chatSession:${leadId}:${threadId}:${expiresAt}`
  const signature = createHmac("sha256", secret).update(message).digest("hex")
  return `${expiresAt}.${toBase64Url(leadId)}.${toBase64Url(threadId)}.${signature}`
}

test("verifyChatSessionToken lève si CHAT_SESSION_SECRET est absent", () => {
  const token = signTestToken("lead_1", "thread_1", Date.now() + 60_000)
  delete process.env.CHAT_SESSION_SECRET
  expect(() => verifyChatSessionToken(token)).toThrow(
    "CHAT_SESSION_SECRET is not set on this Astro deployment",
  )
})

test("verifyChatSessionToken lève si CHAT_SESSION_SECRET fait moins de 32 caractères", () => {
  process.env.CHAT_SESSION_SECRET = "trop-court"
  expect(() => verifyChatSessionToken("1.a.b.deadbeef")).toThrow(
    "CHAT_SESSION_SECRET must be at least 32 characters",
  )
})

test("un jeton signé, non expiré, rend le payload", () => {
  const expiresAt = Date.now() + 60_000
  const token = signTestToken("lead_1", "thread_1", expiresAt)
  expect(verifyChatSessionToken(token, expiresAt - 1)).toEqual({
    leadId: "lead_1",
    threadId: "thread_1",
    expiresAt,
  })
})

test("un jeton expiré rend null, il ne throw pas", () => {
  const expiresAt = Date.now() + 60_000
  const token = signTestToken("lead_1", "thread_1", expiresAt)
  expect(verifyChatSessionToken(token, expiresAt)).toBeNull()
})

test("un segment trafiqué rend null", () => {
  const token = signTestToken("lead_1", "thread_1", Date.now() + 60_000)
  const parts = token.split(".")
  parts[1] = toBase64Url("lead_autre")
  expect(verifyChatSessionToken(parts.join("."))).toBeNull()
})

test("une entrée malformée rend null sans lever", () => {
  expect(() => verifyChatSessionToken("pas-un-jeton")).not.toThrow()
  expect(verifyChatSessionToken("pas-un-jeton")).toBeNull()
  expect(verifyChatSessionToken("")).toBeNull()
})

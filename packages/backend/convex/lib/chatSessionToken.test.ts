import { afterEach, beforeEach, expect, test } from "vitest"
import { signChatSessionToken, verifyChatSessionToken } from "./chatSessionToken"

const SECRET = "a".repeat(32)

beforeEach(() => {
  process.env.CHAT_SESSION_SECRET = SECRET
})
afterEach(() => {
  delete process.env.CHAT_SESSION_SECRET
})

test("signe et vérifie un triplet lead/thread/exp embarqué dans le jeton", async () => {
  const expiresAt = Date.now() + 60_000
  const token = await signChatSessionToken({
    leadId: "lead_1",
    threadId: "thread_1",
    expiresAt,
  })
  // ${expiresAt}.${b64url(leadId)}.${b64url(threadId)}.${hex} — 4 segments
  expect(token.split(".").length).toBe(4)
  const parsed = await verifyChatSessionToken(token)
  expect(parsed).toEqual({ leadId: "lead_1", threadId: "thread_1", expiresAt })
})

test("un jeton expiré rend null, il ne throw pas", async () => {
  const token = await signChatSessionToken({
    leadId: "lead_1",
    threadId: "thread_1",
    expiresAt: Date.now() - 1,
  })
  expect(await verifyChatSessionToken(token)).toBeNull()
})

test("un segment tampered rend null", async () => {
  const token = await signChatSessionToken({
    leadId: "lead_1",
    threadId: "thread_1",
    expiresAt: Date.now() + 60_000,
  })
  const parts = token.split(".")
  const original = parts[1]!
  const mutated = original.replace(/A/g, "B")
  // b64url("lead_1") n'a pas de "A" : sans ce repli le jeton resterait intact.
  parts[1] = mutated === original ? "x" : mutated
  expect(await verifyChatSessionToken(parts.join("."))).toBeNull()
})

test("refuse un secret trop court à la signature", async () => {
  process.env.CHAT_SESSION_SECRET = "short"
  await expect(
    signChatSessionToken({ leadId: "l", threadId: "t", expiresAt: Date.now() + 1000 }),
  ).rejects.toThrow()
})

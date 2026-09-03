import { expect, test } from "vitest"
import { DEFAULT_AGENT_AVATAR_PATH, resolveAgentAvatarUrl } from "./agentAvatar"

test("sans URL stockée, l'avatar est l'asset commité", () => {
  expect(DEFAULT_AGENT_AVATAR_PATH).toBe("/agent-avatar.png")
  expect(resolveAgentAvatarUrl(null)).toBe("/agent-avatar.png")
  expect(resolveAgentAvatarUrl(undefined)).toBe("/agent-avatar.png")
  expect(resolveAgentAvatarUrl("")).toBe("/agent-avatar.png")
  expect(resolveAgentAvatarUrl("   ")).toBe("/agent-avatar.png")
})

test("une URL de médiathèque l'emporte sur le repli", () => {
  expect(resolveAgentAvatarUrl("https://cdn.exemple/avatar.png")).toBe(
    "https://cdn.exemple/avatar.png",
  )
})

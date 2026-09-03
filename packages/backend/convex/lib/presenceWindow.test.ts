import { expect, test } from "vitest"
import { PRESENCE_ONLINE_MS, isOnline } from "./presenceWindow"

test("absent ou trop vieux n'est pas en ligne", () => {
  const now = 1_000_000
  expect(isOnline(undefined, now)).toBe(false)
  expect(isOnline(now - PRESENCE_ONLINE_MS, now)).toBe(false)
  expect(isOnline(now - PRESENCE_ONLINE_MS - 1, now)).toBe(false)
})

test("un heartbeat de moins de 45 s est en ligne", () => {
  const now = 1_000_000
  expect(isOnline(now, now)).toBe(true)
  expect(isOnline(now - PRESENCE_ONLINE_MS + 1, now)).toBe(true)
})

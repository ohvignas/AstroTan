import { expect, test } from "vitest"
import { canWriteSettings } from "./accesReglages"

test("owner et admin écrivent, editor et démo non", () => {
  expect(canWriteSettings({ role: "owner", isDemo: false })).toBe(true)
  expect(canWriteSettings({ role: "admin", isDemo: false })).toBe(true)
  expect(canWriteSettings({ role: "editor", isDemo: false })).toBe(false)
  expect(canWriteSettings({ role: "owner", isDemo: true })).toBe(false)
  expect(canWriteSettings({ role: "editor", isDemo: true })).toBe(false)
  expect(canWriteSettings({ role: undefined, isDemo: false })).toBe(false)
})

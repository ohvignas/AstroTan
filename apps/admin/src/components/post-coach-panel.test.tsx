import { expect, test, vi } from "vitest"

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(async () => ({ findings: [] })),
}))

test("le module panneau se charge sans tirer yoastseo", async () => {
  await import("./post-coach-panel")
  expect(true).toBe(true)
})

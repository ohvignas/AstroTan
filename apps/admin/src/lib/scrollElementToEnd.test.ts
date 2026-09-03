import { expect, test } from "vitest"
import { scrollElementToEnd } from "./scrollElementToEnd"

test("pose scrollTop sur scrollHeight", () => {
  const node = { scrollTop: 12, scrollHeight: 480 }
  scrollElementToEnd(node)
  expect(node.scrollTop).toBe(480)
})

test("ignore un nœud absent", () => {
  expect(() => scrollElementToEnd(null)).not.toThrow()
})

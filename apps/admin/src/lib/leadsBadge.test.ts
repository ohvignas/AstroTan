import { expect, test } from "vitest"
import { leadsBadge } from "./leadsBadge"

test("un compte positif devient la pastille", () => {
  expect(leadsBadge(3)).toBe(3)
})

test("zéro et l'absence ne rendent pas de pastille", () => {
  expect(leadsBadge(0)).toBeUndefined()
  expect(leadsBadge(undefined)).toBeUndefined()
})

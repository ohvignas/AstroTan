import { expect, test } from "vitest"
import { coverPatch } from "./coverPatch"

test("null est envoyé, pas omis", () => {
  expect(coverPatch(null)).toEqual({ coverId: null })
})

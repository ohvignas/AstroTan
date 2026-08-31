import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import { MAX_TARGET_KEYWORD_LENGTH, assertTargetKeyword } from "./content"

function codeDe(fn: () => unknown) {
  try {
    fn()
    throw new Error("aurait dû lever")
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError)
    return (e as ConvexError<{ code: string; field?: string; max?: number }>).data
  }
}

test("80 caractères passent, 81 lèvent FIELD_TOO_LONG", () => {
  expect(assertTargetKeyword("a".repeat(80))).toBe("a".repeat(80))
  expect(codeDe(() => assertTargetKeyword("a".repeat(81)))).toEqual({
    code: "FIELD_TOO_LONG",
    field: "targetKeyword",
    max: MAX_TARGET_KEYWORD_LENGTH,
  })
})

test("trim à l'écriture ; vide = retrait (undefined)", () => {
  expect(assertTargetKeyword("  agence web lyon  ")).toBe("agence web lyon")
  expect(assertTargetKeyword("   ")).toBeUndefined()
  expect(assertTargetKeyword("")).toBeUndefined()
})

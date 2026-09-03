import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import {
  MAX_EXTRA_INSTRUCTIONS,
  appendExtraInstructions,
  normalizeExtraInstructions,
} from "./extraInstructions"

test("undefined et blanc laissent le prompt identique", () => {
  const prompt = "Photographie éditoriale pour la une."
  expect(appendExtraInstructions(prompt, undefined)).toBe(prompt)
  expect(appendExtraInstructions(prompt, "")).toBe(prompt)
  expect(appendExtraInstructions(prompt, "   \n")).toBe(prompt)
  expect(normalizeExtraInstructions(undefined)).toBeUndefined()
  expect(normalizeExtraInstructions("   ")).toBeUndefined()
})

test("une instruction non vide s'ajoute après le prompt existant", () => {
  const prompt = "Photographie éditoriale pour la une."
  const extra = "style plat, pas de texte"
  const result = appendExtraInstructions(prompt, extra)
  expect(result.startsWith(prompt)).toBe(true)
  expect(result).toContain("Instruction complémentaire")
  expect(result).toContain(extra)
  expect(result).not.toBe(prompt)
})

test("500 caractères passent, 501 lèvent FIELD_TOO_LONG", () => {
  const ok = "x".repeat(MAX_EXTRA_INSTRUCTIONS)
  expect(normalizeExtraInstructions(ok)).toBe(ok)
  expect(normalizeExtraInstructions(`  ${ok}  `)).toBe(ok)
  try {
    normalizeExtraInstructions("y".repeat(MAX_EXTRA_INSTRUCTIONS + 1))
    throw new Error("expected FIELD_TOO_LONG")
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    expect((err as ConvexError<{ code: string; field: string; max: number }>).data).toEqual({
      code: "FIELD_TOO_LONG",
      field: "extraInstructions",
      max: MAX_EXTRA_INSTRUCTIONS,
    })
  }
})

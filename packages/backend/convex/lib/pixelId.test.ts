import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import {
  MAX_GOOGLE_TAG_ID_LENGTH,
  MAX_META_PIXEL_ID_LENGTH,
  normaliserPixelId,
} from "./pixelId"

function codeDe(fn: () => unknown): { code: string; field?: string; max?: number } {
  try {
    fn()
    throw new Error("aurait dû lever")
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError)
    return (e as ConvexError<{ code: string; field?: string; max?: number }>).data
  }
}

test("un ID Meta de chiffres passe, trimé ; 5 chiffres minimum, 4 refusés", () => {
  expect(normaliserPixelId("metaPixelId", " 12345 ")).toBe("12345")
  expect(codeDe(() => normaliserPixelId("metaPixelId", "1234")).code).toBe("INVALID_PIXEL_ID")
})

test("null et blanc sont un retrait — chaîne vide, pas undefined", () => {
  expect(normaliserPixelId("metaPixelId", null)).toBe("")
  expect(normaliserPixelId("googleTagId", "   ")).toBe("")
})

test("un ID Meta hors forme lève INVALID_PIXEL_ID avec le champ", () => {
  expect(codeDe(() => normaliserPixelId("metaPixelId", "12a"))).toEqual({
    code: "INVALID_PIXEL_ID",
    field: "metaPixelId",
  })
})

test("un ID trop long lève FIELD_TOO_LONG aux deux champs", () => {
  expect(codeDe(() => normaliserPixelId("metaPixelId", "1".repeat(MAX_META_PIXEL_ID_LENGTH + 1)))).toEqual({
    code: "FIELD_TOO_LONG",
    field: "metaPixelId",
    max: MAX_META_PIXEL_ID_LENGTH,
  })
  expect(codeDe(() => normaliserPixelId("googleTagId", `G-${"A".repeat(MAX_GOOGLE_TAG_ID_LENGTH)}`)).code).toBe(
    "FIELD_TOO_LONG",
  )
})

test("les préfixes Google acceptés passent", () => {
  for (const id of ["G-ABC123", "AW-999", "GT-XYZ", "DC-1"]) {
    expect(normaliserPixelId("googleTagId", id)).toBe(id)
  }
})

test("un tag Google hors préfixe est refusé", () => {
  expect(codeDe(() => normaliserPixelId("googleTagId", "UA-123")).code).toBe("INVALID_PIXEL_ID")
})

test("un label de conversion Ads passe, seul ou après AW-XXX/", () => {
  expect(normaliserPixelId("googleConversionLabel", " AbC-D_efG ")).toBe("AbC-D_efG")
  expect(normaliserPixelId("googleConversionLabel", "AW-123456789/AbC-D_efG")).toBe("AbC-D_efG")
  expect(normaliserPixelId("googleConversionLabel", null)).toBe("")
})

test("un label de conversion hors forme est refusé", () => {
  expect(codeDe(() => normaliserPixelId("googleConversionLabel", "ab"))).toEqual({
    code: "INVALID_PIXEL_ID",
    field: "googleConversionLabel",
  })
  expect(codeDe(() => normaliserPixelId("googleConversionLabel", "pas un label!"))).toEqual({
    code: "INVALID_PIXEL_ID",
    field: "googleConversionLabel",
  })
})

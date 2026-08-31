import { describe, expect, test } from "vitest"
import { choisirIdentifiant, fusionnerPixels } from "./pixelIds"

describe("choisirIdentifiant", () => {
  test("null ou undefined retombe sur le build", () => {
    expect(choisirIdentifiant(null, "123")).toBe("123")
    expect(choisirIdentifiant(undefined, "123")).toBe("123")
  })
  test("une chaîne vide gagne : le pixel est retiré, PUBLIC_* ignoré", () => {
    expect(choisirIdentifiant("", "123")).toBeUndefined()
  })
  test("un ID en base gagne", () => {
    expect(choisirIdentifiant("999", "123")).toBe("999")
  })
})

test("settings.get === null se lit comme jamais saisi", () => {
  const fused = fusionnerPixels(null, { PUBLIC_META_PIXEL_ID: "123", PUBLIC_GOOGLE_TAG_ID: "G-1" })
  expect(fused.PUBLIC_META_PIXEL_ID).toBe("123")
  expect(fused.PUBLIC_GOOGLE_TAG_ID).toBe("G-1")
})

test("fusionnerPixels : null / \"\" / ID sur l'objet projeté", () => {
  const env = { PUBLIC_META_PIXEL_ID: "build-meta", PUBLIC_GOOGLE_TAG_ID: "G-BUILD" }
  expect(fusionnerPixels({ metaPixelId: null, googleTagId: null }, env).PUBLIC_META_PIXEL_ID).toBe(
    "build-meta",
  )
  expect(fusionnerPixels({ metaPixelId: "", googleTagId: "AW-1" }, env).PUBLIC_META_PIXEL_ID).toBeUndefined()
  expect(fusionnerPixels({ metaPixelId: "", googleTagId: "AW-1" }, env).PUBLIC_GOOGLE_TAG_ID).toBe("AW-1")
})

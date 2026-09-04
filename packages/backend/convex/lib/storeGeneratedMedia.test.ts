import { expect, test } from "vitest"
import { generatedMediaMeta } from "./storeGeneratedMedia"

test("le nom de fichier porte le préfixe, le slug et l'extension", () => {
  expect(
    generatedMediaMeta({
      prefix: "og",
      slug: "contact",
      mime: "image/png",
      title: "Nous écrire",
      fallbackAlt: "Image de partage",
    }),
  ).toEqual({
    filename: "og-contact.png",
    alt: "Nous écrire",
    title: "Nous écrire",
  })
})

test("un titre vide retombe sur l'alt de secours", () => {
  expect(
    generatedMediaMeta({
      prefix: "une",
      slug: "article",
      mime: "image/jpeg",
      title: "   ",
      fallbackAlt: "Image de une",
    }).alt,
  ).toBe("Image de une")
})

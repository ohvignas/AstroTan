import { describe, expect, test } from "vitest"
import { REQUIRED_PAGE_SLUGS, isRequiredPage } from "./requiredPages"

describe("isRequiredPage", () => {
  test("les trois pages réglementaires en sont", () => {
    for (const slug of REQUIRED_PAGE_SLUGS) {
      expect(isRequiredPage(slug)).toBe(true)
    }
  })

  test("une page ordinaire n'en est pas", () => {
    expect(isRequiredPage("tarifs")).toBe(false)
    expect(isRequiredPage("accueil")).toBe(false)
  })

  test("la liste couvre exactement ce que le code référence", () => {
    // Si `config/nav.ts` ou `config/consent.ts` gagne un lien vers une
    // quatrième page réglementaire, ce test doit être mis à jour EN MÊME
    // TEMPS — c'est ce qui rend l'oubli visible plutôt que silencieux.
    expect([...REQUIRED_PAGE_SLUGS]).toEqual([
      "mentions-legales",
      "confidentialite",
      "cookies",
    ])
  })
})

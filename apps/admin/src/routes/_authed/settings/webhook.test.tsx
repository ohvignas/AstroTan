import { describe, expect, test } from "vitest"
import source from "./webhook.tsx?raw"
import { shouldShowLastDelivery } from "./webhook"

describe("settings/webhook — texte d'aide", () => {
  test("ne montre plus l'avertissement exemple.co / Enregistrer", () => {
    expect(source).not.toMatch(/Rien ne part avant le clic/)
    expect(source).not.toMatch(/inconnu de passage/)
  })

  test("monte la carte API et garde le HMAC du webhook", () => {
    expect(source).toMatch(/ApiTokenCard/)
    expect(source).toMatch(/x-astrotan-signature/)
  })
})

describe("shouldShowLastDelivery", () => {
  test("montre un succès 2xx daté", () => {
    expect(shouldShowLastDelivery("Envoyé (200)", 1_700_000_000_000)).toBe(true)
    expect(shouldShowLastDelivery("Envoyé (204)", 1_700_000_000_000)).toBe(true)
  })

  test("cache une erreur 410 même datée", () => {
    expect(
      shouldShowLastDelivery(
        "Le scénario n'existe plus à cette adresse (410) — il a été supprimé ou désactivé",
        1_700_000_000_000,
      ),
    ).toBe(false)
  })

  test("cache un succès sans date", () => {
    expect(shouldShowLastDelivery("Envoyé (200)", undefined)).toBe(false)
  })

  test("cache l'absence de statut", () => {
    expect(shouldShowLastDelivery(undefined, 1_700_000_000_000)).toBe(false)
    expect(shouldShowLastDelivery(undefined, undefined)).toBe(false)
  })

  test("cache les autres erreurs", () => {
    expect(
      shouldShowLastDelivery(
        "Adresse injoignable — vérifiez l'URL et que le service tourne",
        1_700_000_000_000,
      ),
    ).toBe(false)
    expect(
      shouldShowLastDelivery(
        "Envoi refusé (403) — le service demande une authentification que nous n'envoyons pas",
        1_700_000_000_000,
      ),
    ).toBe(false)
  })
})

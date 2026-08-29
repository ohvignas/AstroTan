import { describe, expect, test } from "vitest"
import { ORIGINE_INCONNUE, origineDeComptage } from "./originFingerprint"

// Déplacés depuis `leadRateLimit.test.ts` avec la fonction elle-même : une
// seule couche de tests pour une seule fonction, dont les deux limiteurs
// (leads, consentement) héritent maintenant.

describe("origineDeComptage", () => {
  test("une origine absente ou vide tombe dans un seau commun", () => {
    // Et surtout PAS dans une clé unique : une origine différente à chaque
    // requête donnerait un budget neuf à chaque fois, et le compteur ne
    // compterait plus rien.
    expect(origineDeComptage(undefined)).toBe(ORIGINE_INCONNUE)
    expect(origineDeComptage("")).toBe(ORIGINE_INCONNUE)
    expect(origineDeComptage("   ")).toBe(ORIGINE_INCONNUE)
  })

  test("une origine démesurée aussi", () => {
    // Même raison : une clé de longueur libre est une clé qu'on choisit.
    expect(origineDeComptage("x".repeat(129))).toBe(ORIGINE_INCONNUE)
  })

  test("une empreinte normale est gardée telle quelle", () => {
    const empreinte = "a".repeat(64)
    expect(origineDeComptage(empreinte)).toBe(empreinte)
  })
})

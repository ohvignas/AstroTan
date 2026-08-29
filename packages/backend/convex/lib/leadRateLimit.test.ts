import { describe, expect, test } from "vitest"
import {
  LEAD_EMAIL_LIMIT_CONFIG,
  LEAD_ORIGIN_LIMIT_CONFIG,
  ORIGINE_INCONNUE,
  origineDeComptage,
} from "./leadRateLimit"

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

describe("les budgets", () => {
  test("aucune réserve ne s'accumule", () => {
    // `capacity > rate` laisserait une nuit d'inactivité financer au matin
    // une rafale de la taille de la réserve — le geste même qu'on empêche.
    expect(LEAD_ORIGIN_LIMIT_CONFIG.capacity).toBe(LEAD_ORIGIN_LIMIT_CONFIG.rate)
    expect(LEAD_EMAIL_LIMIT_CONFIG.capacity).toBe(LEAD_EMAIL_LIMIT_CONFIG.rate)
  })

  test("l'adresse est plus serrée que l'origine", () => {
    // C'est ce compteur qui protège la boîte de réception des responsables.
    expect(LEAD_EMAIL_LIMIT_CONFIG.rate).toBeLessThan(LEAD_ORIGIN_LIMIT_CONFIG.rate)
  })
})

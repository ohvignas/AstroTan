import { describe, expect, test } from "vitest"
import { LEAD_EMAIL_LIMIT_CONFIG, LEAD_ORIGIN_LIMIT_CONFIG } from "./leadRateLimit"

// `origineDeComptage`/`ORIGINE_INCONNUE` ont déménagé dans
// `originFingerprint.ts`, partagées avec `consentRateLimit.ts` — leurs
// tests avec elles, voir `originFingerprint.test.ts`.

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

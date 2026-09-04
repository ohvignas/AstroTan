import { describe, expect, test } from "vitest"
import {
  COMPLET_AMOUNT_CENTS,
  COMPLET_CURRENCY,
  assertCompletAmount,
  formatCompletPriceFr,
} from "./stripeOffer"

describe("l'offre Complet", () => {
  test("vaut 9,99 € une fois, en centimes", () => {
    expect(COMPLET_AMOUNT_CENTS).toBe(999)
    expect(COMPLET_CURRENCY).toBe("eur")
    expect(formatCompletPriceFr()).toBe("9,99 €")
  })

  test("accepte exactement ce montant", () => {
    expect(() => assertCompletAmount(999, "eur")).not.toThrow()
  })

  test("refuse un montant ou une devise différents", () => {
    expect(() => assertCompletAmount(1, "eur")).toThrow(/AMOUNT_MISMATCH/)
    expect(() => assertCompletAmount(999, "usd")).toThrow(/AMOUNT_MISMATCH/)
    expect(() => assertCompletAmount(998, "eur")).toThrow(/AMOUNT_MISMATCH/)
  })
})

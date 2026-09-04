import { ConvexError } from "convex/values"

// L'offre Complet, en un seul endroit.
//
// Le DOM de `/tarifs` affiche le prix, mais c'est ICI que le checkout
// lit le montant. Un POST trafiqué ne change pas 9,99 €.

export const COMPLET_AMOUNT_CENTS = 999
export const COMPLET_CURRENCY = "eur"
export const COMPLET_PRODUCT_NAME = "AstroTan Complet"

export function formatCompletPriceFr(): string {
  const euros = COMPLET_AMOUNT_CENTS / 100
  return `${euros.toFixed(2).replace(".", ",")} €`
}

export function assertCompletAmount(amountCents: number, currency: string): void {
  if (amountCents !== COMPLET_AMOUNT_CENTS || currency !== COMPLET_CURRENCY) {
    throw new ConvexError({
      code: "AMOUNT_MISMATCH",
      expectedCents: COMPLET_AMOUNT_CENTS,
      expectedCurrency: COMPLET_CURRENCY,
    })
  }
}

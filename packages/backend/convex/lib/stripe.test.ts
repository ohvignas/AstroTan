import { afterEach, beforeEach, expect, test } from "vitest"
import {
  COMPLET_AMOUNT_CENTS,
  COMPLET_CURRENCY,
  STRIPE_CHECKOUT_URL,
  WEBHOOK_TOLERANCE_MS,
  assertPaidAmount,
  buildCheckoutBody,
  signStripeHeader,
  verifyStripeSignature,
} from "./stripe"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = "http://localhost:3001"
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
})

afterEach(() => {
  process.env = originalEnv
})

test("l'offre Complet est 29,99 EUR, pas 9,99", () => {
  expect(COMPLET_AMOUNT_CENTS).toBe(2999)
  expect(COMPLET_CURRENCY).toBe("eur")
})

test("un montant différent de 2999 centimes est refusé", () => {
  expect(() => assertPaidAmount(999, "eur")).toThrow(/AMOUNT_MISMATCH/)
  expect(() => assertPaidAmount(2999, "usd")).toThrow(/AMOUNT_MISMATCH/)
  expect(() => assertPaidAmount(2999, "EUR")).not.toThrow()
  expect(() => assertPaidAmount(2999, "eur")).not.toThrow()
})

test("la session Checkout poste le price id, jamais un montant lu du client", () => {
  const body = buildCheckoutBody({
    priceId: "price_test_complet",
    successUrl: "https://exemple.fr/paiement-ok",
    cancelUrl: "https://exemple.fr/paiement-annule",
  })
  expect(body.get("mode")).toBe("payment")
  expect(body.get("line_items[0][price]")).toBe("price_test_complet")
  expect(body.get("line_items[0][quantity]")).toBe("1")
  expect(body.get("success_url")).toBe("https://exemple.fr/paiement-ok")
  expect(body.get("cancel_url")).toBe("https://exemple.fr/paiement-annule")
  expect(body.get("locale")).toBe("fr")
  expect(body.get("line_items[0][price_data][unit_amount]")).toBeNull()
})

test("sans price id, le montant figé 2999 EUR est écrit côté serveur", () => {
  const body = buildCheckoutBody({
    successUrl: "https://exemple.fr/paiement-ok",
    cancelUrl: "https://exemple.fr/paiement-annule",
  })
  expect(body.get("line_items[0][price_data][unit_amount]")).toBe("2999")
  expect(body.get("line_items[0][price_data][currency]")).toBe("eur")
  expect(body.get("line_items[0][price]")).toBeNull()
})

test("une signature webhook valide est acceptée", async () => {
  const payload = JSON.stringify({
    id: "evt_test",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test", amount_total: 2999, currency: "eur" } },
  })
  const secret = "whsec_test_secret"
  const now = 1_700_000_000
  const header = await signStripeHeader(payload, secret, now)
  const event = await verifyStripeSignature(payload, header, secret, now * 1000)
  expect(event.id).toBe("evt_test")
  expect(event.type).toBe("checkout.session.completed")
})

test("une signature webhook fausse est refusée", async () => {
  const payload = JSON.stringify({ id: "evt_test", type: "checkout.session.completed" })
  const now = 1_700_000_000
  const header = await signStripeHeader(payload, "whsec_bon", now)
  await expect(
    verifyStripeSignature(payload, header, "whsec_mauvais", now * 1000),
  ).rejects.toMatchObject({ data: { code: "STRIPE_SIGNATURE_INVALID" } })
})

test("un horodatage trop vieux est refusé", async () => {
  const payload = JSON.stringify({ id: "evt_old", type: "checkout.session.completed" })
  const secret = "whsec_test_secret"
  const stamped = 1_700_000_000
  const header = await signStripeHeader(payload, secret, stamped)
  await expect(
    verifyStripeSignature(
      payload,
      header,
      secret,
      stamped * 1000 + WEBHOOK_TOLERANCE_MS + 1,
    ),
  ).rejects.toMatchObject({ data: { code: "STRIPE_SIGNATURE_STALE" } })
})

test("l'URL Checkout Stripe est celle de l'API, pas un domaine inventé", () => {
  expect(STRIPE_CHECKOUT_URL).toBe("https://api.stripe.com/v1/checkout/sessions")
})

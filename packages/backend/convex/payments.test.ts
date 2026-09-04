import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { makeTestConvex } from "../testing/betterAuthFixture"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = "https://admin.example.test"
  process.env.WEB_SITE_URL = "https://www.example.test"
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env.STRIPE_SECRET_KEY = "sk_test_payments_fixture"
})

afterEach(() => {
  process.env = originalEnv
  vi.unstubAllGlobals()
})

test("sans clé Stripe, le checkout refuse", async () => {
  delete process.env.STRIPE_SECRET_KEY
  const t = makeTestConvex()
  await expect(t.action(api.payments.createCheckout, {})).rejects.toThrow(
    /STRIPE_NOT_CONFIGURED/,
  )
})

test("le checkout demande 999 centimes et renvoie l'URL Stripe", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = decodeURIComponent(
        typeof init?.body === "string" ? init.body : String(init?.body ?? ""),
      )
      expect(body).toContain("[unit_amount]=999")
      expect(body).toContain("[currency]=eur")
      return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }),
  )
  const t = makeTestConvex()
  const result = await t.action(api.payments.createCheckout, {})
  expect(result.url).toBe("https://checkout.stripe.com/c/pay/cs_test")
})

test("enregistrer est idempotent sur la session Stripe", async () => {
  const t = makeTestConvex()
  const args = {
    stripeSessionId: "cs_test_idem",
    email: "acheteur@example.com",
    amountCents: 999,
    currency: "eur",
  }
  const first = await t.mutation(internal.payments.enregistrer, args)
  const second = await t.mutation(internal.payments.enregistrer, args)
  expect(first.created).toBe(true)
  expect(second.created).toBe(false)
  expect(first.id).toBe(second.id)
})

test("enregistrer refuse un montant différent de l'offre", async () => {
  const t = makeTestConvex()
  await expect(
    t.mutation(internal.payments.enregistrer, {
      stripeSessionId: "cs_test_wrong",
      amountCents: 1,
      currency: "eur",
    }),
  ).rejects.toThrow(/AMOUNT_MISMATCH/)
})

import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { signStripeHeader } from "./lib/stripe"
import { STRIPE_WEBHOOK_PATH } from "./lib/stripeHttp"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_WEBHOOK_SECRET
  delete process.env.STRIPE_PRICE_ID
})

afterEach(() => {
  process.env = originalEnv
  vi.unstubAllGlobals()
})

test("publicStatus dit ready/livemode sans jamais rendre la clé", async () => {
  const t = makeTestConvex()
  expect(await t.query(api.payments.publicStatus, {})).toEqual({
    ready: false,
    livemode: false,
  })
  process.env.STRIPE_SECRET_KEY = "sk_test_ne-pas-afficher"
  expect(await t.query(api.payments.publicStatus, {})).toEqual({
    ready: true,
    livemode: false,
  })
  process.env.STRIPE_SECRET_KEY = "sk_live_ne-pas-afficher"
  expect(await t.query(api.payments.publicStatus, {})).toEqual({
    ready: true,
    livemode: true,
  })
})

test("sans clé Stripe, createCheckout refuse", async () => {
  const t = makeTestConvex()
  await expect(t.action(api.payments.createCheckout, {})).rejects.toMatchObject({
    data: { code: "STRIPE_NOT_CONFIGURED" },
  })
})

test("createCheckout demande 2999 EUR et rend l'URL Stripe", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_ok"
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = String(init?.body ?? "")
    expect(body).toContain("unit_amount")
    expect(body).toContain("2999")
    expect(body).toContain("currency")
    expect(body).toContain("eur")
    expect(body).toContain("success_url=https%3A%2F%2Fexemple.fr%2Fpaiement-ok")
    return new Response(
      JSON.stringify({
        id: "cs_test_ok",
        url: "https://checkout.stripe.com/c/pay/cs_test_ok",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  })
  vi.stubGlobal("fetch", fetchMock)

  const t = makeTestConvex()
  const result = await t.action(api.payments.createCheckout, {})
  expect(result.url).toBe("https://checkout.stripe.com/c/pay/cs_test_ok")
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test("un webhook sans signature est refusé", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
  const t = makeTestConvex()
  const res = await t.fetch(STRIPE_WEBHOOK_PATH, {
    method: "POST",
    body: JSON.stringify({ id: "evt_x", type: "checkout.session.completed" }),
  })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: "STRIPE_SIGNATURE_INVALID" })
})

test("checkout.session.completed écrit une ligne purchases", async () => {
  const secret = "whsec_test"
  process.env.STRIPE_WEBHOOK_SECRET = secret
  const payload = JSON.stringify({
    id: "evt_paid",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_paid_1",
        amount_total: 2999,
        currency: "eur",
        customer_details: { email: "acheteur@exemple.fr" },
      },
    },
  })
  const now = Math.floor(Date.now() / 1000)
  const header = await signStripeHeader(payload, secret, now)
  const t = makeTestConvex()
  const res = await t.fetch(STRIPE_WEBHOOK_PATH, {
    method: "POST",
    headers: { "stripe-signature": header },
    body: payload,
  })
  expect(res.status).toBe(200)
  const rows = await t.run((ctx) => ctx.db.query("purchases").collect())
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    stripeSessionId: "cs_paid_1",
    email: "acheteur@exemple.fr",
    amountCents: 2999,
    currency: "eur",
    status: "paid",
  })
})

test("un webhook rejoué n'écrit pas une seconde ligne", async () => {
  const secret = "whsec_test"
  process.env.STRIPE_WEBHOOK_SECRET = secret
  const payload = JSON.stringify({
    id: "evt_replay",
    type: "checkout.session.completed",
    data: {
      object: { id: "cs_replay", amount_total: 2999, currency: "eur" },
    },
  })
  const now = Math.floor(Date.now() / 1000)
  const header = await signStripeHeader(payload, secret, now)
  const t = makeTestConvex()
  const once = { method: "POST" as const, headers: { "stripe-signature": header }, body: payload }
  expect((await t.fetch(STRIPE_WEBHOOK_PATH, once)).status).toBe(200)
  expect((await t.fetch(STRIPE_WEBHOOK_PATH, once)).status).toBe(200)
  const rows = await t.run((ctx) => ctx.db.query("purchases").collect())
  expect(rows).toHaveLength(1)
})

test("un montant autre que 2999 est refusé à l'enregistrement", async () => {
  const t = makeTestConvex()
  await expect(
    t.mutation(internal.payments.enregistrer, {
      stripeSessionId: "cs_wrong",
      amountCents: 999,
      currency: "eur",
    }),
  ).rejects.toMatchObject({ data: { code: "AMOUNT_MISMATCH" } })
})

test("liste exige une session", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.payments.liste, {})).rejects.toThrow()
  const email = `pay-${Date.now()}@example.com`
  const user = await seedUser(t, {
    email,
    password: "correct horse battery staple pay",
    name: "Payeur",
    role: "editor",
  })
  await signIn(t, email, "correct horse battery staple pay")
  const identity = await identityFor(t, user.id)
  expect(await identity.query(api.payments.liste, {})).toEqual([])
})

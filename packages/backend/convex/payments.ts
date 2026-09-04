import { ConvexError, v } from "convex/values"
import { action, httpAction, internalMutation } from "./_generated/server"
import { api, internal } from "./_generated/api"
import { MUTATION_REGISTRY } from "./_registry"
import { lireSecret } from "./secrets"
import {
  COMPLET_AMOUNT_CENTS,
  COMPLET_CURRENCY,
  COMPLET_PRODUCT_NAME,
  assertCompletAmount,
} from "./lib/stripeOffer"
import { verifyStripeSignature } from "./lib/stripeSignature"

function sitePublicUrl(): string {
  const url = process.env.WEB_SITE_URL ?? process.env.SITE_URL
  if (!url) throw new ConvexError({ code: "SITE_URL_MISSING" })
  return url.replace(/\/$/, "")
}

export const createCheckout = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const secret = await lireSecret(ctx, "STRIPE_SECRET_KEY")
    if (!secret) throw new ConvexError({ code: "STRIPE_NOT_CONFIGURED" })

    const origin = sitePublicUrl()
    const body = new URLSearchParams({
      mode: "payment",
      success_url: `${origin}/paiement-ok?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/paiement-annule`,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": COMPLET_CURRENCY,
      "line_items[0][price_data][unit_amount]": String(COMPLET_AMOUNT_CENTS),
      "line_items[0][price_data][product_data][name]": COMPLET_PRODUCT_NAME,
    })

    const reponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    })
    if (!reponse.ok) throw new ConvexError({ code: "STRIPE_UNAVAILABLE" })
    const session = (await reponse.json()) as { url?: unknown }
    if (typeof session.url !== "string" || session.url.length === 0) {
      throw new ConvexError({ code: "STRIPE_UNAVAILABLE" })
    }
    return { url: session.url }
  },
})

export const enregistrer = internalMutation({
  args: {
    stripeSessionId: v.string(),
    email: v.optional(v.string()),
    amountCents: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    assertCompletAmount(args.amountCents, args.currency)
    const existing = await ctx.db
      .query("purchases")
      .withIndex("by_session", (q) => q.eq("stripeSessionId", args.stripeSessionId))
      .unique()
    if (existing !== null) return existing._id
    return await ctx.db.insert("purchases", {
      stripeSessionId: args.stripeSessionId,
      email: args.email,
      amountCents: args.amountCents,
      currency: args.currency,
      status: "paid",
      createdAt: Date.now(),
    })
  },
})

export const webhook = httpAction(async (ctx, request) => {
  const secret = await lireSecret(ctx, "STRIPE_WEBHOOK_SECRET")
  if (!secret) return new Response("not configured", { status: 503 })

  const payload = await request.text()
  const header = request.headers.get("stripe-signature") ?? ""
  const ok = await verifyStripeSignature({ secret, payload, header })
  if (!ok) return new Response("invalid signature", { status: 400 })

  let event: { type?: unknown; data?: { object?: Record<string, unknown> } }
  try {
    event = JSON.parse(payload) as typeof event
  } catch {
    return new Response("invalid json", { status: 400 })
  }
  if (event.type !== "checkout.session.completed") {
    return new Response("ok", { status: 200 })
  }

  const session = event.data?.object ?? {}
  const sessionId = typeof session.id === "string" ? session.id : ""
  if (sessionId.length === 0) return new Response("missing session", { status: 400 })

  const amount =
    typeof session.amount_total === "number" ? session.amount_total : NaN
  const currency = typeof session.currency === "string" ? session.currency : ""
  const email =
    typeof (session.customer_details as { email?: unknown } | undefined)?.email ===
    "string"
      ? (session.customer_details as { email: string }).email
      : undefined

  await ctx.runMutation(internal.payments.enregistrer, {
    stripeSessionId: sessionId,
    email,
    amountCents: amount,
    currency,
  })
  return new Response("ok", { status: 200 })
})

MUTATION_REGISTRY.push({
  name: "payments.createCheckout",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: (t) => t.action(api.payments.createCheckout, {}),
})

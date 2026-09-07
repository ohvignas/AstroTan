import { ConvexError, v } from "convex/values"
import { action, internalMutation, query } from "./_generated/server"
import { api } from "./_generated/api"
import { requireRole } from "./lib/authz"
import { MUTATION_REGISTRY } from "./_registry"
import { lireSecret } from "./secrets"
import {
  STRIPE_API_VERSION,
  STRIPE_CHECKOUT_URL,
  assertPaidAmount,
  buildCheckoutBody,
} from "./lib/stripe"

function originePublique(): string {
  const brut = process.env.WEB_SITE_URL
  if (!brut) throw new ConvexError({ code: "NOT_CONFIGURED", field: "WEB_SITE_URL" })
  return brut.replace(/\/+$/, "")
}

/** Prêt / live — jamais un fragment de clé. Pour le bandeau « mode test » des tarifs. */
export const publicStatus = query({
  args: {},
  handler: async (ctx): Promise<{ ready: boolean; livemode: boolean }> => {
    const cle = await lireSecret(ctx, "STRIPE_SECRET_KEY")
    if (!cle) return { ready: false, livemode: false }
    return { ready: true, livemode: cle.startsWith("sk_live_") }
  },
})

export const createCheckout = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const cle = await lireSecret(ctx, "STRIPE_SECRET_KEY")
    if (!cle) throw new ConvexError({ code: "STRIPE_NOT_CONFIGURED" })

    const origine = originePublique()
    const body = buildCheckoutBody({
      priceId: process.env.STRIPE_PRICE_ID || undefined,
      successUrl: `${origine}/paiement-ok`,
      cancelUrl: `${origine}/paiement-annule`,
    })

    const reponse = await fetch(STRIPE_CHECKOUT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cle}`,
        "content-type": "application/x-www-form-urlencoded",
        "stripe-version": STRIPE_API_VERSION,
      },
      body,
    })
    const texte = await reponse.text()
    if (!reponse.ok) {
      throw new ConvexError({ code: "STRIPE_CHECKOUT_FAILED" })
    }
    const session: unknown = JSON.parse(texte)
    const url =
      typeof session === "object" &&
      session !== null &&
      typeof (session as { url?: unknown }).url === "string"
        ? (session as { url: string }).url
        : null
    if (!url) throw new ConvexError({ code: "STRIPE_CHECKOUT_FAILED" })
    return { url }
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
    assertPaidAmount(args.amountCents, args.currency)
    const existante = await ctx.db
      .query("purchases")
      .withIndex("by_session", (q) => q.eq("stripeSessionId", args.stripeSessionId))
      .unique()
    if (existante !== null) return existante._id
    return ctx.db.insert("purchases", {
      stripeSessionId: args.stripeSessionId,
      email: args.email,
      amountCents: args.amountCents,
      currency: args.currency.toLowerCase(),
      status: "paid",
      createdAt: Date.now(),
    })
  },
})

export const liste = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    return ctx.db.query("purchases").order("desc").take(50)
  },
})

MUTATION_REGISTRY.push({
  name: "payments.createCheckout",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: (t) => t.action(api.payments.createCheckout, {}),
})

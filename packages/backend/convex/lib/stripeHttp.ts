import { httpAction } from "../_generated/server"
import { internal } from "../_generated/api"
import type { HttpRouter } from "convex/server"
import { lireSecret } from "../secrets"
import {
  assertPaidAmount,
  verifyStripeSignature,
} from "./stripe"

export const STRIPE_WEBHOOK_PATH = "/stripe/webhook"

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

export function registerStripe(http: HttpRouter) {
  const webhook = httpAction(async (ctx, request) => {
    if (request.method !== "POST") {
      return json({ error: "METHOD_NOT_ALLOWED" }, 405)
    }
    const secret = await lireSecret(ctx, "STRIPE_WEBHOOK_SECRET")
    if (!secret) return json({ error: "STRIPE_NOT_CONFIGURED" }, 503)

    const payload = await request.text()
    let event
    try {
      event = await verifyStripeSignature(
        payload,
        request.headers.get("stripe-signature"),
        secret,
      )
    } catch (error) {
      const code =
        error !== null && typeof error === "object" && "data" in error
          ? (error as { data?: { code?: string } }).data?.code
          : undefined
      if (code === "STRIPE_SIGNATURE_STALE") {
        return json({ error: "STRIPE_SIGNATURE_STALE" }, 400)
      }
      return json({ error: "STRIPE_SIGNATURE_INVALID" }, 400)
    }

    if (event.type !== "checkout.session.completed") {
      return json({ received: true, ignored: event.type }, 200)
    }

    const session = event.data.object
    const sessionId = typeof session.id === "string" ? session.id : null
    const amount =
      typeof session.amount_total === "number" ? session.amount_total : null
    const currency =
      typeof session.currency === "string" ? session.currency : null
    if (sessionId === null || amount === null || currency === null) {
      return json({ error: "STRIPE_SESSION_INCOMPLETE" }, 400)
    }
    try {
      assertPaidAmount(amount, currency)
    } catch {
      return json({ error: "AMOUNT_MISMATCH" }, 400)
    }

    const customer = session.customer_details
    const email =
      customer !== null &&
      typeof customer === "object" &&
      typeof (customer as { email?: unknown }).email === "string"
        ? (customer as { email: string }).email
        : typeof session.customer_email === "string"
          ? session.customer_email
          : undefined

    await ctx.runMutation(internal.payments.enregistrer, {
      stripeSessionId: sessionId,
      email,
      amountCents: amount,
      currency: currency.toLowerCase(),
    })
    return json({ received: true }, 200)
  })

  http.route({ path: STRIPE_WEBHOOK_PATH, method: "POST", handler: webhook })
}

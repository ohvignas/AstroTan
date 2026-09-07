import { ConvexError } from "convex/values"
import { timingSafeEqualHex } from "./previewToken"

/** Offre Complet : 29,99 €, une fois. Figé ici, jamais lu du DOM. */
export const COMPLET_AMOUNT_CENTS = 2999
export const COMPLET_CURRENCY = "eur"
export const COMPLET_OFFER = "complet"

export const STRIPE_CHECKOUT_URL = "https://api.stripe.com/v1/checkout/sessions"
export const STRIPE_API_VERSION = "2025-03-31.basil"

/** 5 minutes — même borne que `stripe.webhooks.constructEvent`. */
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000

export type StripeEvent = {
  id: string
  type: string
  data: { object: Record<string, unknown> }
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))
  return hex(new Uint8Array(signature))
}

/**
 * En-tête `Stripe-Signature` de test — même format que
 * `stripe.webhooks.generateTestHeaderString`.
 */
export async function signStripeHeader(
  payload: string,
  secret: string,
  timestampSec: number,
): Promise<string> {
  const signature = await hmacHex(secret, `${timestampSec}.${payload}`)
  return `t=${timestampSec},v1=${signature}`
}

function parseSignatureHeader(header: string): { timestamp: number; v1: string[] } {
  let timestamp = Number.NaN
  const v1: string[] = []
  for (const part of header.split(",")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (name === "t") timestamp = Number(value)
    if (name === "v1") v1.push(value)
  }
  return { timestamp, v1 }
}

/**
 * Vérifie `Stripe-Signature` (HMAC-SHA256 de `t.payload`) sans le SDK.
 * Refuse une signature absente, fausse, ou un horodatage hors fenêtre.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowMs: number = Date.now(),
): Promise<StripeEvent> {
  if (!header) {
    throw new ConvexError({ code: "STRIPE_SIGNATURE_INVALID" })
  }
  const { timestamp, v1 } = parseSignatureHeader(header)
  if (!Number.isFinite(timestamp) || v1.length === 0) {
    throw new ConvexError({ code: "STRIPE_SIGNATURE_INVALID" })
  }
  if (Math.abs(nowMs - timestamp * 1000) > WEBHOOK_TOLERANCE_MS) {
    throw new ConvexError({ code: "STRIPE_SIGNATURE_STALE" })
  }
  const expected = await hmacHex(secret, `${timestamp}.${payload}`)
  const ok = v1.some((candidate) => timingSafeEqualHex(candidate, expected))
  if (!ok) {
    throw new ConvexError({ code: "STRIPE_SIGNATURE_INVALID" })
  }
  const parsed: unknown = JSON.parse(payload)
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConvexError({ code: "STRIPE_SIGNATURE_INVALID" })
  }
  const event = parsed as StripeEvent
  if (typeof event.id !== "string" || typeof event.type !== "string") {
    throw new ConvexError({ code: "STRIPE_SIGNATURE_INVALID" })
  }
  return event
}

export function assertPaidAmount(amountCents: number, currency: string): void {
  if (
    amountCents !== COMPLET_AMOUNT_CENTS ||
    currency.toLowerCase() !== COMPLET_CURRENCY
  ) {
    throw new ConvexError({
      code: "AMOUNT_MISMATCH",
      expectedCents: COMPLET_AMOUNT_CENTS,
      currency: COMPLET_CURRENCY,
    })
  }
}

export function buildCheckoutBody(args: {
  priceId?: string
  successUrl: string
  cancelUrl: string
}): URLSearchParams {
  const body = new URLSearchParams()
  body.set("mode", "payment")
  body.set("line_items[0][quantity]", "1")
  if (args.priceId) {
    body.set("line_items[0][price]", args.priceId)
  } else {
    body.set("line_items[0][price_data][currency]", COMPLET_CURRENCY)
    body.set("line_items[0][price_data][unit_amount]", String(COMPLET_AMOUNT_CENTS))
    body.set("line_items[0][price_data][product_data][name]", "AstroTan Complet")
  }
  body.set("success_url", args.successUrl)
  body.set("cancel_url", args.cancelUrl)
  body.set("locale", "fr")
  body.set("metadata[offer]", COMPLET_OFFER)
  return body
}

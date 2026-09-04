export const prerender = false

import type { APIRoute } from "astro"
import { ConvexError } from "convex/values"
import { api } from "@astrotan/backend/convex/_generated/api"
import { getConvexClient } from "../../lib/convexClient"

function messagePour(code: string): string {
  if (code === "STRIPE_NOT_CONFIGURED") {
    return "Le paiement n'est pas encore ouvert sur cette démo."
  }
  if (code === "STRIPE_UNAVAILABLE" || code === "SITE_URL_MISSING") {
    return "Le paiement est temporairement indisponible. Réessayez dans un instant."
  }
  return "Le paiement n'a pas pu démarrer."
}

export const POST: APIRoute = async () => {
  try {
    const { url } = await getConvexClient().action(api.payments.createCheckout, {})
    return new Response(null, {
      status: 303,
      headers: { location: url },
    })
  } catch (error) {
    const code =
      error instanceof ConvexError &&
      typeof error.data === "object" &&
      error.data !== null &&
      "code" in error.data &&
      typeof (error.data as { code: unknown }).code === "string"
        ? (error.data as { code: string }).code
        : "STRIPE_UNAVAILABLE"
    return new Response(messagePour(code), {
      status: code === "STRIPE_NOT_CONFIGURED" ? 503 : 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  }
}

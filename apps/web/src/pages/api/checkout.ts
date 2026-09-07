export const prerender = false

import type { APIRoute } from "astro"
import { api } from "@astrotan/backend/convex/_generated/api"
import { getConvexClient } from "../../lib/convexClient"

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { location: to } })
}

/**
 * GET aussi : derrière Traefik, Astro refuse les POST de formulaire
 * (« Cross-site POST ») faute de `security.allowedDomains` figé au build.
 * Ouvrir une session n'est pas un paiement — le montant reste côté Convex.
 */
export const ouvrirCheckout: APIRoute = async () => {
  try {
    const { url } = await getConvexClient().action(api.payments.createCheckout, {})
    if (!url) return redirect("/tarifs?erreur=indisponible")
    return redirect(url)
  } catch {
    return redirect("/tarifs?erreur=indisponible")
  }
}

export const GET = ouvrirCheckout
export const POST = ouvrirCheckout

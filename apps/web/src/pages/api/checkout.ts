export const prerender = false

import type { APIRoute } from "astro"
import { api } from "@astrotan/backend/convex/_generated/api"
import { getConvexClient } from "../../lib/convexClient"

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { location: to } })
}

export const POST: APIRoute = async () => {
  try {
    const { url } = await getConvexClient().action(api.payments.createCheckout, {})
    if (!url) return redirect("/tarifs?erreur=indisponible")
    return redirect(url)
  } catch {
    return redirect("/tarifs?erreur=indisponible")
  }
}

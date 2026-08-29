// Le journal de traçabilité du consentement.
//
// Éteint par défaut : sans `CONSENT_LOG_SECRET`, cette route répond 204 et
// n'écrit rien. Un adoptant qui n'active pas la traçabilité n'a donc aucune
// route ouverte, et aucune ligne à conserver.
//
// Le navigateur ne parle jamais à Convex directement — même raison que
// `/api/contact` : le secret partagé ne quitte pas le serveur, et une
// variable `PUBLIC_` reviendrait à ne pas en avoir.
//
// Toute réponse est un 204 sans corps, y compris en cas de refus. Ce n'est
// pas de la paresse : la personne vient d'exprimer un choix, ce choix est
// déjà appliqué et stocké dans son navigateur, et rien de ce qui se passe
// ici ne doit pouvoir défaire ou retarder cela. Le journal est notre
// obligation, pas la sienne.
export const prerender = false

import type { APIRoute } from "astro"
import { api } from "@astrotan/backend/convex/_generated/api"
import { getConvexClient } from "../../lib/convexClient"

/** Un enregistrement fait moins de 500 octets ; au-delà, ce n'en est pas un. */
const MAX_BODY_BYTES = 2_048

const ACTIONS = new Set(["accept_all", "reject_all", "custom", "update"])

function accepted(): Response {
  return new Response(null, { status: 204 })
}

export const POST: APIRoute = async ({ request }) => {
  const secret = process.env.CONSENT_LOG_SECRET
  if (!secret) return accepted()

  const length = Number(request.headers.get("content-length") ?? "0")
  if (length > MAX_BODY_BYTES) return accepted()

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return accepted()
  }

  if (typeof payload !== "object" || payload === null) return accepted()
  const body = payload as Record<string, unknown>

  // Validation stricte AVANT Convex : la mutation refuserait de toute façon,
  // mais un appel réseau par requête malformée est un coût que n'importe qui
  // peut nous infliger depuis l'extérieur.
  if (
    typeof body.consentVersion !== "string" ||
    typeof body.visitorId !== "string" ||
    typeof body.consentId !== "string" ||
    typeof body.timestamp !== "string" ||
    typeof body.action !== "string" ||
    !ACTIONS.has(body.action) ||
    typeof body.analytics !== "boolean" ||
    typeof body.marketing !== "boolean" ||
    typeof body.preferences !== "boolean"
  ) {
    return accepted()
  }

  try {
    await getConvexClient().mutation(api.consent.record, {
      secret,
      consentVersion: body.consentVersion,
      visitorId: body.visitorId,
      consentId: body.consentId,
      action: body.action as "accept_all" | "reject_all" | "custom" | "update",
      timestamp: body.timestamp,
      analytics: body.analytics,
      marketing: body.marketing,
      preferences: body.preferences,
    })
  } catch {
    // Un journal indisponible ne doit pas empêcher quelqu'un d'exprimer un
    // refus. On perd une ligne de preuve ; on ne perd pas le consentement,
    // qui vit dans le navigateur de la personne.
  }

  return accepted()
}

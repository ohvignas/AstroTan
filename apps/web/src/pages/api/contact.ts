// La porte par laquelle un visiteur écrit.
//
// C'est le SEUL chemin par lequel `apps/web` provoque une écriture en base.
// Partout ailleurs il ne fait que lire des queries publiques. L'exception
// est étroite par construction, et chaque propriété ci-dessous porte une
// part de cette étroitesse :
//
//  - le formulaire ne parle jamais à Convex directement. Le navigateur ne
//    peut ni prouver son adresse IP, ni s'auto-limiter honnêtement ;
//  - le secret partagé ne quitte jamais le serveur. Le mettre dans une
//    variable `PUBLIC_` reviendrait à ne pas en avoir ;
//  - le pot de miel répond comme un succès. Dire « raté » à un robot, c'est
//    lui apprendre à réussir.
export const prerender = false

import type { APIRoute } from "astro"
import { api } from "@astrotan/backend/convex/_generated/api"
import {
  MAX_LEAD_BODY_LENGTH,
  MAX_LEAD_EMAIL_LENGTH,
  MAX_LEAD_NAME_LENGTH,
  MAX_LEAD_SUBJECT_LENGTH,
} from "@astrotan/backend/convex/content"
import { getConvexClient } from "../../lib/convexClient"

/** Le nom du champ que seul un robot remplit. */
const HONEYPOT_FIELD = "site_web"

/**
 * Au-delà, la requête est refusée avant d'atteindre Convex.
 *
 * Somme des bornes du modèle, plus une marge pour l'encodage du formulaire.
 * Sans ce plafond, un corps de plusieurs mégaoctets serait lu en entier
 * avant d'être rejeté — le refus coûterait alors plus cher que l'acceptation.
 */
const MAX_BODY_BYTES =
  MAX_LEAD_NAME_LENGTH +
  MAX_LEAD_EMAIL_LENGTH +
  MAX_LEAD_SUBJECT_LENGTH +
  MAX_LEAD_BODY_LENGTH +
  2_048

function redirect(to: string): Response {
  // 303 et non 302 : après un POST, il force le navigateur à suivre en GET.
  // C'est ce qui évite qu'un rafraîchissement renvoie le formulaire.
  return new Response(null, { status: 303, headers: { location: to } })
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const secret = process.env.LEAD_SUBMIT_SECRET
  // Un déploiement sans secret refuse, jamais ne laisse passer : l'oubli de
  // configuration est le cas fréquent, et c'est celui où une porte ouverte
  // ne se voit pas.
  // Toute issue ramène sur la page, jamais sur un écran vide : une réponse
  // sans corps affiche la page d'erreur du navigateur, et la personne perd
  // ce qu'elle venait d'écrire sans comprendre pourquoi.
  if (!secret) return redirect("/contact?erreur=indisponible")

  const length = Number(request.headers.get("content-length") ?? "0")
  if (length > MAX_BODY_BYTES) return redirect("/contact?erreur=too_long")

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return redirect("/contact?erreur=illisible")
  }

  // Le pot de miel : un champ caché par le CSS, que personne ne voit et
  // qu'aucun humain ne remplit. Rempli, on répond exactement comme un
  // succès — même code, même redirection — pour ne rien apprendre à qui
  // essaie.
  if (String(form.get(HONEYPOT_FIELD) ?? "").length > 0) {
    return redirect("/contact?envoye=1")
  }

  const name = String(form.get("name") ?? "")
  const email = String(form.get("email") ?? "")
  const subject = String(form.get("subject") ?? "")
  const body = String(form.get("message") ?? "")

  try {
    await getConvexClient().mutation(api.leads.submit, {
      secret,
      name,
      email,
      subject: subject.length > 0 ? subject : undefined,
      body,
      // Recopié tel quel, jamais pour identifier quelqu'un : il sert à
      // reconnaître une vague d'envois automatiques après coup.
      userAgent: request.headers.get("user-agent") ?? undefined,
    })
  } catch (error) {
    // Les refus du modèle — adresse invalide, champ vide, trop long — sont
    // des erreurs de saisie, pas des pannes. Elles reviennent à la page
    // avec un motif, plutôt que sur un écran d'erreur qui perdrait ce que
    // la personne avait écrit.
    const code =
      error !== null && typeof error === "object" && "data" in error
        ? (error as { data?: { code?: string } }).data?.code
        : undefined
    if (code === "INVALID_EMAIL" || code === "EMPTY" || code === "TOO_LONG") {
      return redirect(`/contact?erreur=${code.toLowerCase()}`)
    }
    // Panne inattendue — Convex injoignable, secret refusé. La personne
    // n'y peut rien, mais elle doit savoir que son message n'est pas parti.
    return redirect("/contact?erreur=indisponible")
  }

  // `clientAddress` est lu ici et pas plus haut : il n'a de sens qu'une fois
  // le message accepté, et le lire tôt donnerait l'illusion qu'il sert à
  // filtrer alors que la limitation vit dans Convex.
  void clientAddress

  return redirect("/contact?envoye=1")
}

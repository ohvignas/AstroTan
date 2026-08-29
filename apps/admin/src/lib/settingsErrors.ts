import { ConvexError } from "convex/values"

// Tous les codes que `api.settings.update` et `api.settings.setHomePage`
// peuvent lever, traduits pour un opérateur — même forme que
// `lib/pageErrors.ts` et `lib/redirectErrors.ts`.
//
// Ce dictionnaire vivait dans `routes/_authed/settings.tsx`, avec un
// commentaire qui justifiait de l'y garder : « les réglages n'ont qu'un
// seul écran ». Ce n'est plus vrai — ils en ont sept, dont quatre appellent
// `settings.update`. La raison de le promouvoir ici est exactement celle
// que ce commentaire annonçait à l'avance : deux copies d'un dictionnaire
// d'erreurs divergent.
const SETTINGS_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN:
    "Action refusée par le serveur : les réglages du site sont réservés au propriétaire et aux administrateurs.",
  UNAUTHENTICATED: "Votre session a expiré. Reconnectez-vous.",
  BANNED: "Votre compte a été suspendu.",
  NOT_FOUND: "Introuvable — a peut-être déjà été modifié ailleurs.",
  INVALID_SITE_NAME: "Le nom du site ne peut pas être vide.",
}

export function describeSettingsError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data
    if (data && typeof data === "object" && "code" in data) {
      const payload = data as Record<string, unknown>
      const code = payload.code
      // `FIELD_TOO_LONG`/`FIELD_TOO_MANY` portent le champ fautif et la
      // limite ; un « trop long » générique laisserait deviner lequel des
      // champs de l'écran est visé.
      if (code === "FIELD_TOO_LONG") {
        const field = typeof payload.field === "string" ? payload.field : "Un champ"
        const max =
          typeof payload.max === "number"
            ? ` (maximum ${payload.max} caractères)`
            : ""
        return `${field} dépasse la limite autorisée${max}.`
      }
      if (code === "FIELD_TOO_MANY") {
        const field = typeof payload.field === "string" ? payload.field : "Une liste"
        const max =
          typeof payload.max === "number" ? ` (maximum ${payload.max})` : ""
        return `${field} contient trop d'éléments${max}.`
      }
      // Le seul refus qu'un opérateur puisse réellement provoquer ici en
      // se doublant lui-même : choisir une page qu'une autre session vient
      // de renommer ou de supprimer.
      if (code === "UNKNOWN_PAGE") {
        const slug = typeof payload.slug === "string" ? ` « ${payload.slug} »` : ""
        return `Aucune page ne porte le slug${slug} — elle a peut-être été renommée ou supprimée. Rechargez la liste.`
      }
      if (typeof code === "string" && SETTINGS_ERROR_MESSAGES[code]) {
        return SETTINGS_ERROR_MESSAGES[code]
      }
    }
  }
  return "Une erreur inattendue est survenue."
}

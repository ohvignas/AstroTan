import { ConvexError } from "convex/values"

// Tous les codes que `api.settings.update`, `api.settings.setHomePage` et
// `api.secrets.set` peuvent lever, traduits pour un opérateur — même forme que
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
  // `convex/secrets.ts`. La commande arrive dans la charge de l'erreur
  // (`commande`), mais l'écran l'affiche déjà en clair au-dessus du champ :
  // la répéter ici ferait deux endroits à corriger le jour où elle change.
  SECRETS_KEY_MISSING:
    "Aucune clé maîtresse (SECRETS_KEY) sur ce déploiement : rien n'est enregistré. Un jeton stocké sans chiffrement serait lisible dans n'importe quel export de la base.",
  SECRETS_KEY_MALFORMED:
    "La clé maîtresse (SECRETS_KEY) est présente mais inutilisable : elle doit faire 32 octets encodés en base64.",
  // `convex/settings.ts` (le domaine déclaré) et `convex/dns.ts` (celui
  // qu'on vérifie) lèvent le même code : les deux passent par
  // `normaliserHote`, et un opérateur ne peut le provoquer qu'en collant
  // une URL entière ou une adresse avec un port.
  INVALID_DOMAIN:
    "Ce n'est pas un nom de domaine : il s'écrit « exemple.fr », sans https://, sans barre oblique, sans port.",
  EMPTY_SECRET:
    "Un jeton vide ne veut rien dire. Pour retirer celui qui est en base, utilisez « Retirer de la base ».",
  // `convex/settings.ts`, via `estAdresseValide` (`lib/expediteur.ts`) —
  // la même fonction que l'écran appelle avant d'envoyer. Ce message ne
  // sert donc qu'aux chemins qui contournent le champ : une seconde
  // session, ou un `npx convex run`.
  INVALID_EMAIL_FROM:
    "Ce n'est pas une adresse d'expédition : écrivez « bonjour@exemple.fr » ou « Nom <bonjour@exemple.fr> ».",
  INVALID_PIXEL_ID:
    "Cet identifiant n'a pas la forme attendue (chiffres pour Meta, G-/AW-/GT-/DC- pour Google).",
  INVALID_OPENROUTER_MODEL:
    "Ce modèle n'est pas dans la liste proposée. Choisissez-en un autre.",
  INVALID_OPENROUTER_IMAGE_MODEL:
    "Ce modèle d'image n'est pas dans la liste proposée. Choisissez-en un autre.",
  INVALID_OPENROUTER_OCR_MODEL:
    "Ce modèle OCR n'est pas dans la liste proposée. Choisissez-en un autre.",
  OPENROUTER_NOT_CONFIGURED:
    "Sans clé OpenRouter, l'index de savoir ne peut pas être calculé. Configurez-la dans la section Modèle IA.",
  INVALID_SOCIAL_NETWORK:
    "Ce réseau n'est pas dans la liste proposée. Choisissez-en un autre.",
  DUPLICATE_SOCIAL:
    "Ce réseau est déjà dans la liste. Un seul lien par réseau.",
  INVALID_SOCIAL_URL:
    "Chaque lien de réseau doit commencer par http:// ou https://.",
  INVALID_AGENT_CHAT_COLOR:
    "La couleur du chat s'écrit en hexadécimal, par exemple #171717 ou #f60.",
}

// ---------------------------------------------------------------------
// Les refus de `convex/emails.ts`.
//
// Ils portent leur propre phrase — celle de `validerGabarit` pour un
// gabarit, celle du catalogue pour un email non désactivable — et la
// recopier ici en ferait une seconde version à maintenir. On préfère
// celle du serveur, qui NOMME la variable fautive.
// ---------------------------------------------------------------------

function decrireRefusEmail(payload: Record<string, unknown>): string | null {
  if (payload.code === "GABARIT_INVALIDE") {
    return typeof payload.message === "string"
      ? payload.message
      : "Ce texte a été refusé par le serveur."
  }
  if (payload.code === "EMAIL_NON_DESACTIVABLE") {
    const raison = typeof payload.raison === "string" ? ` ${payload.raison}` : ""
    return `Cet envoi ne peut pas être coupé.${raison}`
  }
  return null
}

export function describeSettingsError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data
    if (data && typeof data === "object" && "code" in data) {
      const payload = data as Record<string, unknown>
      const code = payload.code
      const refusEmail = decrireRefusEmail(payload)
      if (refusEmail !== null) return refusEmail
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

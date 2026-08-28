import { ConvexError } from "convex/values"

// Every code `api.pages.*`'s mutations/actions can throw, mapped to an
// operator-facing message — same shape and reasoning as
// `routes/_authed/users.tsx`'s own `ERROR_MESSAGES`/`describeError`, kept
// as a separate copy here rather than a shared generic one because the
// *codes* themselves are specific to this domain (`FIELD_TOO_LONG` names a
// page field this screen knows how to talk about, `users.tsx` has
// no equivalent). Shared between the list screen and the editor screen —
// both call the same mutations and would otherwise have to keep two
// copies of this dictionary in sync by hand.
const PAGE_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN:
    "Action refusée par le serveur : vous n'avez pas l'autorité pour ceci.",
  UNAUTHENTICATED: "Votre session a expiré. Reconnectez-vous.",
  BANNED: "Votre compte a été suspendu.",
  NOT_FOUND:
    "Introuvable — a peut-être déjà été modifiée ou supprimée ailleurs.",
  SLUG_ALREADY_EXISTS: "Ce slug est déjà utilisé par une autre page.",
  INVALID_TITLE: "Le titre ne peut pas être vide.",
  INVALID_SLUG: "Le slug ne peut pas être vide.",
  INVALID_PREVIEW_TOKEN: "Le lien de prévisualisation n'est plus valide.",
}

// `FIELD_TOO_LONG` carries a `field`/`max` payload (`content.ts`'s
// `assertLength`) worth surfacing precisely — which field, what the limit
// actually is — rather than a generic "too long" that leaves an operator
// guessing which of several inputs on the page tripped it.
function describeFieldTooLong(data: {
  field?: unknown
  max?: unknown
}): string {
  const field = typeof data.field === "string" ? data.field : "un champ"
  const max =
    typeof data.max === "number" ? ` (maximum ${data.max} caractères)` : ""
  return `${field} dépasse la limite autorisée${max}.`
}

/**
 * Les deux refus du lot 4 qui portent une donnée dans leur charge utile.
 *
 * Sans eux, un opérateur qui renomme une page voit « une erreur inattendue
 * est survenue » alors que la cause est précise et que la marche à suivre
 * l'est aussi. C'est le pire des deux mondes : refusé, et sans savoir
 * pourquoi.
 */
function describeSlugRefusal(
  code: string,
  data: Record<string, unknown>
): string | null {
  if (code === "SLUG_FIXED_BY_ROUTE") {
    const file = typeof data.file === "string" ? data.file : "son fichier"
    return (
      `Le chemin de cette page est fixé par son fichier ${file}. ` +
      `C'est lui qui décide de l'URL — renommez le fichier dans le code du ` +
      `site, et le slug suivra.`
    )
  }
  if (code === "SLUG_HAS_REDIRECT") {
    const to = typeof data.to === "string" ? data.to : "un autre chemin"
    return (
      `Une redirection active occupe déjà ce chemin et renvoie vers ${to}. ` +
      `La page naîtrait invisible : le visiteur serait redirigé avant de ` +
      `l'atteindre. Supprimez ou désactivez cette redirection dans ` +
      `Redirections, ou choisissez un autre slug.`
    )
  }
  return null
}

export function describePageError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data
    if (data && typeof data === "object" && "code" in data) {
      const code = (data as { code?: unknown }).code
      if (code === "FIELD_TOO_LONG")
        return describeFieldTooLong(data as Record<string, unknown>)
      if (typeof code === "string") {
        const refusal = describeSlugRefusal(code, data as Record<string, unknown>)
        if (refusal !== null) return refusal
      }
      if (typeof code === "string" && PAGE_ERROR_MESSAGES[code])
        return PAGE_ERROR_MESSAGES[code]
    }
  }
  return "Une erreur inattendue est survenue."
}

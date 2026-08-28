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

export function describePageError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data
    if (data && typeof data === "object" && "code" in data) {
      const code = (data as { code?: unknown }).code
      if (code === "FIELD_TOO_LONG")
        return describeFieldTooLong(data as Record<string, unknown>)
      if (typeof code === "string" && PAGE_ERROR_MESSAGES[code])
        return PAGE_ERROR_MESSAGES[code]
    }
  }
  return "Une erreur inattendue est survenue."
}

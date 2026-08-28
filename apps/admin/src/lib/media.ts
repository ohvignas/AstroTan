import { ConvexError } from "convex/values"

// Formatting and error copy for the media library, kept beside
// `lib/pageErrors.ts` and built the same way: a dictionary of the codes
// `api.media.*` actually throws, mapped to operator-facing French, with a
// generic fallback rather than a blank message for anything unrecognized.
//
// A separate module from `pageErrors.ts` rather than a shared generic one,
// for the reason that file already gives: the *codes* are domain-specific.
// `MEDIA_IN_USE` and `UNSUPPORTED_MIME` mean nothing on a page, and
// `SLUG_ALREADY_EXISTS` means nothing on a file. It lives in `lib/` rather
// than inside a component because both the library route and the reusable
// picker call the same mutations, and two copies of this dictionary would
// drift.

/**
 * A byte count as an operator reads it.
 *
 * Decimal units (1 ko = 1000 o), which is what a file manager shows and
 * what the "10 Mo" in the upload dialog's copy has to agree with — the
 * server's own limit is 10 MiB, so the message says 10,5 Mo and means it.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes < 1000) return `${bytes} o`

  const units = ["ko", "Mo", "Go"]
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ${units[unit]}`
}

const MEDIA_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN:
    "Action refusée par le serveur : vous n'avez pas l'autorité pour ceci.",
  UNAUTHENTICATED: "Votre session a expiré. Reconnectez-vous.",
  BANNED: "Votre compte a été suspendu.",
  NOT_FOUND: "Média introuvable — il a peut-être déjà été supprimé ailleurs.",
  INVALID_ALT:
    "Le texte alternatif est obligatoire : décrivez l'image en une phrase.",
  INVALID_FILENAME: "Le nom de fichier ne peut pas être vide.",
  ALREADY_REGISTERED: "Ce fichier est déjà présent dans la médiathèque.",
  MEDIA_IN_USE:
    "Suppression refusée : ce fichier est encore référencé par une page ou un article. Retirez-le d'abord de son contenu.",
}

// `UNSUPPORTED_MIME` and `FILE_TOO_LARGE` carry a payload worth surfacing —
// which type was refused, what the limit actually is — rather than a
// generic refusal that leaves an operator guessing what to change about
// the file they just picked.
function describeUnsupportedMime(data: { mime?: unknown }): string {
  const mime = typeof data.mime === "string" ? ` (${data.mime})` : ""
  return `Ce type de fichier${mime} n'est pas accepté. Formats autorisés : PNG, JPEG, WebP, AVIF, GIF.`
}

function describeFileTooLarge(data: { max?: unknown }): string {
  const max =
    typeof data.max === "number" ? ` (maximum ${formatFileSize(data.max)})` : ""
  return `Ce fichier est trop volumineux${max}.`
}

function describeFieldTooLong(data: { field?: unknown; max?: unknown }): string {
  const field = typeof data.field === "string" ? data.field : "un champ"
  const max =
    typeof data.max === "number" ? ` (maximum ${data.max} caractères)` : ""
  return `${field} dépasse la limite autorisée${max}.`
}

export function describeMediaError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data
    if (data && typeof data === "object" && "code" in data) {
      const code = (data as { code?: unknown }).code
      const payload = data as Record<string, unknown>
      if (code === "UNSUPPORTED_MIME") return describeUnsupportedMime(payload)
      if (code === "FILE_TOO_LARGE") return describeFileTooLarge(payload)
      if (code === "FIELD_TOO_LONG") return describeFieldTooLong(payload)
      if (typeof code === "string" && MEDIA_ERROR_MESSAGES[code])
        return MEDIA_ERROR_MESSAGES[code]
    }
  }
  return "Une erreur inattendue est survenue."
}

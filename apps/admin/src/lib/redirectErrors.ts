import { ConvexError } from "convex/values"

// Error copy for the redirects screen, built like `lib/pageErrors.ts` and
// `lib/media.ts`: a dictionary of the codes `api.redirects.*` actually
// throws, mapped to operator-facing French, with a generic fallback rather
// than a blank message for anything unrecognized.
//
// It gets its own module — and more care than the other two — for a reason
// specific to this domain. Every refusal here corresponds to something the
// operator was about to do that would have broken the site: a redirect
// whose `from` shadows live content swallows it silently, because the
// middleware runs before the route. `PATH_ALREADY_SERVED` is the code that
// stopped it, and an operator who reads only the code learns nothing about
// *what* is in the way or whether they can move it. Each sentence below
// exists to answer that.
//
// It lives in `lib/` rather than inside the route because `SLUG_HAS_REDIRECT`
// belongs to the same vocabulary and is thrown by `pages.create`/`update`
// on a different screen — the mirror image of the same exclusion. One
// dictionary rather than two that drift.

/**
 * What the operator was doing when the server refused.
 *
 * Only `enable` changes the copy, and it is the one that needed it. A
 * refused re-enable is the interesting refusal: the operator disabled that
 * redirect earlier precisely to make room for something else, so the
 * question they actually have is "what is on that path now" — and they
 * must be told, unambiguously, that the row stayed off. A toggle that
 * appears to flip and then quietly springs back is the worst outcome this
 * screen can produce.
 */
export type RedirectErrorContext = {
  action: "enable"
  /** The refused redirect's `from`, so the banner names which row failed. */
  from: string
}

/** `tarifs` → `/tarifs`; `/tarifs` → `/tarifs`. Stored paths carry no leading slash. */
function asPath(value: string): string {
  return value.startsWith("/") ? value : `/${value}`
}

const REDIRECT_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN:
    "Action refusée par le serveur : les redirections sont réservées au propriétaire et aux administrateurs.",
  UNAUTHENTICATED: "Votre session a expiré. Reconnectez-vous.",
  BANNED: "Votre compte a été suspendu.",
  NOT_FOUND:
    "Redirection introuvable — elle a peut-être déjà été supprimée ailleurs.",
  INVALID_FROM: "Le chemin de départ ne peut pas être vide.",
  REDIRECT_LOOP:
    "La destination est le chemin de départ lui-même : le navigateur boucle et affiche une erreur, ce qui est pire que la 404 à corriger.",
}

// `path` is the only field name `redirects.*` puts in a `FIELD_TOO_LONG`,
// and it covers both inputs at once (the mutation bounds `from` and `to`
// against the same constant). Translated rather than echoed: "path dépasse
// la limite" is not a sentence an operator should have to read.
const FIELD_LABELS: Record<string, string> = {
  path: "Le chemin",
  to: "La destination",
}

/**
 * The four ways a path can already be answered, each said in full.
 *
 * `reason` and `detail` come straight from `lib/servedPaths.ts`, and the
 * split matters: for `page` and `post`, `detail` is the *title* of what is
 * in the way, and the operator can go move it. For `route`, `detail` is
 * the path, and the thing in the way is a file in the site's own source —
 * there is no dashboard action that frees it. Saying "supprimez la page
 * d'abord" there would send an operator hunting through a list for a page
 * that does not exist.
 */
function describePathAlreadyServed(data: {
  reason?: unknown
  detail?: unknown
}): string {
  const detail = typeof data.detail === "string" ? data.detail : ""

  switch (data.reason) {
    case "route":
      return `Le chemin ${detail || "demandé"} est déjà servi par le site lui-même : une page écrite en code y répond. Ce chemin ne peut pas être libéré depuis le tableau de bord — il faudrait retirer le fichier correspondant du code du site. Choisissez un autre chemin de départ.`
    case "page":
      return `Une page porte déjà ce chemin${detail ? ` : « ${detail} »` : ""} — publiée ou en brouillon, la garde compte les deux, car un brouillon publié plus tard se retrouverait masqué. Renommez ou supprimez cette page d'abord, ou choisissez un autre chemin de départ.`
    case "post":
      return `Un article porte déjà ce chemin${detail ? ` : « ${detail} »` : ""}. Les articles sont servis sous /blog/ — renommez ou supprimez celui-ci d'abord, ou choisissez un autre chemin de départ.`
    case "reserved":
      return `Le chemin ${detail || "demandé"} est réservé par le site : il sert la liste des articles. Choisissez un autre chemin de départ.`
    default:
      // A `reason` this dictionary does not know can only come from a
      // backend that grew a fifth source of truth. Say the true part.
      return "Ce chemin est déjà servi par le site : une redirection le masquerait. Choisissez un autre chemin de départ."
  }
}

function describeCode(code: unknown, payload: Record<string, unknown>): string | null {
  if (code === "PATH_ALREADY_SERVED") return describePathAlreadyServed(payload)

  if (code === "SLUG_HAS_REDIRECT") {
    // The mirror image, thrown by `pages.create`/`update` rather than by
    // `redirects.*`: a page cannot take a slug an active redirect already
    // answers, or it would be born invisible.
    const slug = typeof payload.slug === "string" ? asPath(payload.slug) : "ce chemin"
    const to = typeof payload.to === "string" ? ` vers ${asPath(payload.to)}` : ""
    return `Une redirection active envoie déjà ${slug}${to}. Une page prenant ce slug naîtrait invisible : le middleware la redirigerait avant que sa route ne soit atteinte. Désactivez ou supprimez la redirection d'abord.`
  }

  if (code === "UNSAFE_HREF") {
    const field =
      typeof payload.field === "string" && FIELD_LABELS[payload.field]
        ? FIELD_LABELS[payload.field]
        : "La destination"
    return `${field} doit être un chemin du site (commençant par /) ou une adresse en https:, http:, mailto: ou tel:. Une adresse commençant par // sort du site en ressemblant à un chemin, et un chemin relatif change de cible selon la page d'où on le lit : les deux sont refusés.`
  }

  if (code === "FROM_ALREADY_EXISTS") {
    const from = typeof payload.from === "string" ? ` ${asPath(payload.from)}` : ""
    return `Une redirection part déjà de${from || " ce chemin"}. Modifiez-la plutôt que d'en créer une seconde — un chemin ne peut avoir qu'une destination.`
  }

  if (code === "FIELD_TOO_LONG") {
    const field =
      typeof payload.field === "string" && FIELD_LABELS[payload.field]
        ? FIELD_LABELS[payload.field]
        : "Ce champ"
    const max =
      typeof payload.max === "number" ? ` (maximum ${payload.max} caractères)` : ""
    return `${field} dépasse la limite autorisée${max}.`
  }

  if (typeof code === "string" && REDIRECT_ERROR_MESSAGES[code]) {
    return REDIRECT_ERROR_MESSAGES[code]
  }
  return null
}

export function describeRedirectError(
  error: unknown,
  context?: RedirectErrorContext
): string {
  let message = "Une erreur inattendue est survenue."

  if (error instanceof ConvexError) {
    const data = error.data
    if (data && typeof data === "object" && "code" in data) {
      const payload = data as Record<string, unknown>
      message = describeCode(payload.code, payload) ?? message
    }
  }

  if (context?.action === "enable") {
    // Wrapped rather than replaced: the body already says what is in the
    // way, and the two clauses added here say which row it was and what
    // state it is in now.
    return `Réactivation de ${asPath(context.from)} refusée. ${message} La redirection reste désactivée.`
  }
  return message
}

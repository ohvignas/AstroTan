import { isSafeHref } from "./safeHref"
import { normaliserHote } from "./hoteNu"
import { estOrigineLocale } from "./refreshCible"

// Un `<img>` dans un email n'est chargé que si Gmail (ou Outlook) peut
// l'atteindre depuis Internet. `ctx.storage.getUrl` rend une URL
// `*.convex.cloud` souvent signée, parfois locale : le client affiche
// alors l'icône cassée et l'alt. On ne pose donc une image que si l'URL
// est une origine HTTPS publique que nous contrôlons.

const CHEMIN_LOGO = "/logo"

const HOTES_STORAGE = /(\.convex\.cloud|\.convex\.site)$/i

export function estUrlLogoEmail(url: string | null | undefined): boolean {
  if (!url || !isSafeHref(url)) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== "https:") return false
  if (estOrigineLocale(url)) return false
  if (HOTES_STORAGE.test(parsed.hostname)) return false
  return true
}

/** `{origine publique}/logo`, ou `null` si Gmail ne pourrait pas suivre. */
export function urlLogoEmail(webOrigin: string | null | undefined): string | null {
  if (!webOrigin) return null
  let parsed: URL
  try {
    parsed = new URL(webOrigin)
  } catch {
    return null
  }
  const candidat = `${parsed.origin}${CHEMIN_LOGO}`
  return estUrlLogoEmail(candidat) ? candidat : null
}

/**
 * Pied discret : le domaine déclaré, sinon l'hôte public du site.
 * Jamais le `siteName` — il figure déjà dans l'en-tête.
 */
export function piedEmail(
  declaredDomain: string | null | undefined,
  webOrigin: string | null | undefined,
): string | null {
  const hote = declaredDomain ? normaliserHote(declaredDomain) : null
  if (hote) return hote
  if (!webOrigin || estOrigineLocale(webOrigin)) return null
  try {
    const host = new URL(webOrigin).hostname
    return host && !HOTES_STORAGE.test(host) ? host : null
  } catch {
    return null
  }
}

function aLAirDuneImage(res: Response): boolean {
  const type = (res.headers.get("content-type") ?? "").toLowerCase()
  return type.startsWith("image/") || type.length === 0
}

/** Si l'URL ne répond pas comme une image, on n'émet pas de `<img>`. */
export async function garantirLogoEmail(
  url: string | null | undefined,
): Promise<string | null> {
  if (!url || !estUrlLogoEmail(url)) return null
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow" })
    if (head.ok && aLAirDuneImage(head)) return url
    if (head.status === 405 || head.status === 501) {
      const get = await fetch(url, { method: "GET", redirect: "follow" })
      if (get.ok && aLAirDuneImage(get)) return url
    }
  } catch {
    return null
  }
  return null
}

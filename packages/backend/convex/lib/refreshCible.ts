const BOUCLE_LOCALE = new Set(["localhost", "127.0.0.1", "[::1]"])

function hoteDe(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function portDe(url: string): string {
  try {
    return new URL(url).port
  } catch {
    return ""
  }
}

/** Boucle locale, y compris `localhost:3001` (admin) et `:4321` (site). */
export function estOrigineLocale(url: string | null | undefined): boolean {
  if (!url) return false
  const hote = hoteDe(url)
  return hote !== null && BOUCLE_LOCALE.has(hote)
}

function estOrigineAdmin(url: string): boolean {
  return estOrigineLocale(url) && portDe(url) === "3001"
}

function origineDeclaree(declaredDomain: string | null | undefined): string | null {
  const hote = declaredDomain?.trim().toLowerCase().replace(/\.$/, "")
  if (!hote) return null
  return `https://${hote}`
}

/**
 * L'origine du site public à viser pour un refresh (revalidate, pas Umami).
 *
 * En DEV, si le domaine déclaré n'est pas ce poste, on garde `WEB_SITE_URL`
 * (`localhost:4321`) — pas le domaine de prod, pas l'admin `:3001`.
 * Hors DEV, le domaine des settings l'emporte.
 */
export function origineCibleRefresh(input: {
  declaredDomain: string | null | undefined
  webSiteUrl: string | null | undefined
  isDev: boolean
}): string | null {
  const web = input.webSiteUrl?.replace(/\/$/, "") ?? null
  const webUtile = web && !estOrigineAdmin(web) ? web : null
  const declare = origineDeclaree(input.declaredDomain)

  if (input.isDev) return webUtile
  return declare ?? webUtile
}

/**
 * L'origine à matcher dans DataForSEO / les stats SEO.
 *
 * Ce n'est PAS le cache HTML : en DEV, `origineCibleRefresh` reste sur
 * `localhost:4321`. Ici le domaine déclaré l'emporte toujours — Google
 * ne classe pas `localhost`.
 */
export function origineCibleStats(input: {
  declaredDomain: string | null | undefined
  webSiteUrl: string | null | undefined
}): string | null {
  const declare = origineDeclaree(input.declaredDomain)
  if (declare) return declare
  const web = input.webSiteUrl?.replace(/\/$/, "") ?? null
  return web && !estOrigineAdmin(web) ? web : null
}

/** L'autre hôte du couple apex / www — jamais un domaine différent. */
export function hoteJumeauWww(hote: string): string {
  const n = hote.trim().toLowerCase().replace(/\.$/, "")
  return n.startsWith("www.") ? n.slice(4) : `www.${n}`
}

/**
 * Cible Labs / Backlinks : domaine sans `https://` ni `www.` (doc DataForSEO).
 * L'apex d'abord — `www` n'est qu'un repli si cet apex est vraiment vide.
 */
export function cibleApex(hote: string): string {
  return hote
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/\.$/, "")
    .replace(/^www\./, "")
}

export function snapshotStatsVide(
  rows: { keyword: string }[],
  counts: { backlinks: number; referringDomains: number } | null,
): boolean {
  const sansMots = rows.length === 0
  const sansLiens =
    counts === null || (counts.backlinks === 0 && counts.referringDomains === 0)
  return sansMots && sansLiens
}

/** Repli www seulement si l'apex a répondu et qu'il est vide — pas sur 401/402/40400. */
export function doitEssayerJumeau(snap: {
  labsOk: boolean
  rows: { keyword: string }[]
  counts: { backlinks: number; referringDomains: number } | null
}): boolean {
  if (!snap.labsOk && snap.counts === null) return false
  return snapshotStatsVide(snap.rows, snap.counts)
}

export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/connectors/google/callback"

export function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, "")
}

export function googleOAuthRedirectUri(origin: string): string {
  return `${stripTrailingSlash(origin)}${GOOGLE_OAUTH_CALLBACK_PATH}`
}

export function resolveAdminOrigin(input: {
  windowOrigin?: string
  siteUrl?: string
}): string {
  const live = input.windowOrigin?.trim()
  if (live) return stripTrailingSlash(live)
  const fromEnv = input.siteUrl?.trim()
  if (fromEnv) return stripTrailingSlash(fromEnv)
  return ""
}

function hostnameOf(value: string): string | null {
  try {
    const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`)
    return url.hostname.toLowerCase()
  } catch {
    return null
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
}

/** Domaine public, seulement s'il risque d'être confondu avec l'origine OAuth. */
export function publicSiteIfRelevant(input: {
  adminOrigin: string
  declaredDomain?: string | null
  webSiteUrl?: string | null
}): string | null {
  const stored = input.declaredDomain?.trim()
  const fromWeb = input.webSiteUrl?.trim()
  const label =
    stored && stored.length > 0
      ? stored
      : fromWeb && fromWeb.length > 0
        ? stripTrailingSlash(fromWeb)
        : null
  if (!label) return null

  const publicHost = hostnameOf(label)
  const adminHost = hostnameOf(input.adminOrigin)
  if (!publicHost || !adminHost) return null
  if (publicHost === adminHost) return null
  if (isLoopback(publicHost) && isLoopback(adminHost)) return null
  return label
}

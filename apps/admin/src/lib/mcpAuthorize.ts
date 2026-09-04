export const MCP_POPUP_NAME = "astrotan-mcp-authorize"
export const MCP_POPUP_FEATURES = "popup=yes,width=480,height=720"
export const MCP_OAUTH_MESSAGE_TYPE = "astrotan-mcp-oauth" as const

export type McpOAuthPopupMessage = { type: typeof MCP_OAUTH_MESSAGE_TYPE; ok: boolean }

export function canOpenAuthorize(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "https:") return true
    if (parsed.protocol !== "http:") return false
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
  } catch {
    return false
  }
}

export function isBareAuthorizeUrl(url: string): boolean {
  try {
    return !new URL(url).searchParams.get("client_id")
  } catch {
    return true
  }
}

export type McpRemoteTransport = "http" | "sse"

// Transports distants du spec : Streamable HTTP (`http`) et HTTP+SSE (`sse`).
// Un « fichier MCP » (mcp.json Cursor/Claude, bundle filesystem) n'est pas
// un 4e transport réseau — c'est une commande locale. Pas d'upload, pas d'UI.

export function inferMcpTransport(url: string): McpRemoteTransport {
  try {
    const path = new URL(url.trim()).pathname.replace(/\/$/, "")
    if (path.endsWith("/mcp")) return "http"
    return "sse"
  } catch {
    return "sse"
  }
}

export function needsMcpOAuth(serverUrl: string, authorizeUrl: string): boolean {
  const explicit = authorizeUrl.trim()
  if (explicit.length > 0) {
    return canOpenAuthorize(explicit) && isBareAuthorizeUrl(explicit)
  }
  return canOpenAuthorize(serverUrl.trim())
}

export function mcpConnectorSubtitle(server: {
  url: string
  authorizeUrl?: string | null
  headersConfigured: boolean
}): string {
  let host = "MCP"
  try {
    host = new URL(server.url).hostname
  } catch {
    /* URL invalide : garder le libellé générique */
  }
  if (!server.headersConfigured && needsMcpOAuth(server.url, server.authorizeUrl ?? "")) {
    return `À autoriser · ${host}`
  }
  return `Connecté · ${host}`
}

export function deriveAuthorizeUrl(_serverUrl: string): string | null {
  return null
}

export function resolveAuthorizeUrl(serverUrl: string, authorizeUrl: string): string | null {
  const explicit = authorizeUrl.trim()
  if (explicit.length > 0) {
    if (!canOpenAuthorize(explicit) || isBareAuthorizeUrl(explicit)) return null
    return explicit
  }
  return deriveAuthorizeUrl(serverUrl)
}

export function openMcpAuthorizePopup(url: string): Window | null {
  return window.open(url, MCP_POPUP_NAME, MCP_POPUP_FEATURES)
}

export function isMcpOAuthPopupMessage(data: unknown): data is McpOAuthPopupMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    data.type === MCP_OAUTH_MESSAGE_TYPE &&
    "ok" in data &&
    typeof data.ok === "boolean"
  )
}

export function listenMcpOAuthPopup(onResult: (ok: boolean) => void): () => void {
  const handler = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return
    if (!isMcpOAuthPopupMessage(event.data)) return
    onResult(event.data.ok)
  }
  window.addEventListener("message", handler)
  return () => window.removeEventListener("message", handler)
}

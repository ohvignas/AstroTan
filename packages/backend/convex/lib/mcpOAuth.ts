export const MCP_OAUTH_CALLBACK_PATH = "/api/connectors/mcp/callback"
export const MCP_OAUTH_TTL_MS = 10 * 60 * 1000

export function mcpOAuthRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}${MCP_OAUTH_CALLBACK_PATH}`
}

export function base64url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const raw = new Uint8Array(32)
  crypto.getRandomValues(raw)
  const verifier = base64url(raw)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

export function generateState(): string {
  const raw = new Uint8Array(16)
  crypto.getRandomValues(raw)
  return base64url(raw)
}

export function buildMcpAuthorizeUrl(args: {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  resource: string
  scope?: string
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
    resource: args.resource,
  })
  if (args.scope) params.set("scope", args.scope)
  return `${args.authorizationEndpoint}?${params}`
}

function readString(json: object, key: string): string {
  if (!(key in json)) return ""
  const value = (json as Record<string, unknown>)[key]
  return typeof value === "string" ? value.trim() : ""
}

export function parseAsMetadata(json: unknown): {
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
  tokenEndpointAuthMethod: "none" | "client_secret_post"
} | null {
  if (typeof json !== "object" || json === null) return null
  const authorizationEndpoint = readString(json, "authorization_endpoint")
  const tokenEndpoint = readString(json, "token_endpoint")
  if (!authorizationEndpoint || !tokenEndpoint) return null
  return {
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: readString(json, "registration_endpoint"),
    tokenEndpointAuthMethod: pickTokenAuthMethod(json),
  }
}

function pickTokenAuthMethod(json: object): "none" | "client_secret_post" {
  const raw = (json as Record<string, unknown>).token_endpoint_auth_methods_supported
  const methods = Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === "string")
    : []
  if (methods.includes("none")) return "none"
  return "client_secret_post"
}

export function parseWwwAuthenticateResourceMetadata(header: string | null): string | null {
  if (!header) return null
  const quoted = /resource_metadata\s*=\s*"([^"]+)"/i.exec(header)
  if (quoted?.[1]) return quoted[1].trim()
  const bare = /resource_metadata\s*=\s*([^\s,]+)/i.exec(header)
  return bare?.[1]?.replace(/^"|"$/g, "").trim() || null
}

export function parseAuthorizationServers(json: unknown): string[] {
  if (typeof json !== "object" || json === null) return []
  const raw = (json as Record<string, unknown>).authorization_servers
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

export function parseScopesSupported(json: unknown): string {
  if (typeof json !== "object" || json === null) return ""
  const raw = (json as Record<string, unknown>).scopes_supported
  if (!Array.isArray(raw)) return ""
  return raw
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join(" ")
}

export function wellKnownMetadataUrls(
  target: string,
  kind: "oauth-protected-resource" | "oauth-authorization-server",
): string[] {
  const parsed = new URL(target)
  const path = parsed.pathname.replace(/\/$/, "")
  const urls: string[] = []
  if (path.length > 0) urls.push(`${parsed.origin}/.well-known/${kind}${path}`)
  urls.push(`${parsed.origin}/.well-known/${kind}`)
  return urls
}

export function parsePrmResource(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null
  const resource = readString(json, "resource")
  return resource.length > 0 ? resource : null
}

export function parseRegisteredClient(json: unknown): {
  clientId: string
  clientSecret: string | null
} | null {
  if (typeof json !== "object" || json === null) return null
  const clientId = readString(json, "client_id")
  if (clientId.length === 0) return null
  const secret = readString(json, "client_secret")
  return { clientId, clientSecret: secret.length > 0 ? secret : null }
}

export function parseAccessToken(json: unknown): string | null {
  return parseTokenResponse(json)?.accessToken ?? null
}

export type McpTokenSet = {
  accessToken: string
  refreshToken: string | null
  expiresIn: number | null
}

export const MCP_ACCESS_DEFAULT_TTL_SEC = 15 * 60
export const MCP_ACCESS_SKEW_MS = 60_000

const MCP_OAUTH_PAYLOAD_KEYS = new Set([
  "refresh_token",
  "expires_at",
  "token_endpoint",
  "client_id",
  "client_secret",
  "resource",
])

export type McpOauthFields = {
  refresh_token: string
  expires_at: number
  token_endpoint: string
  client_id: string
  client_secret: string | null
  resource: string
}

export type McpSecretPayload = {
  headers: Record<string, string>
  oauth: McpOauthFields | null
}

export function parseTokenResponse(json: unknown): McpTokenSet | null {
  if (typeof json !== "object" || json === null) return null
  const accessToken = readString(json, "access_token")
  if (accessToken.length === 0) return null
  const refresh = readString(json, "refresh_token")
  const rawExpires = (json as Record<string, unknown>).expires_in
  const expiresIn =
    typeof rawExpires === "number" && Number.isFinite(rawExpires) && rawExpires > 0
      ? Math.floor(rawExpires)
      : typeof rawExpires === "string" && /^\d+$/.test(rawExpires)
        ? Number(rawExpires)
        : null
  return {
    accessToken,
    refreshToken: refresh.length > 0 ? refresh : null,
    expiresIn,
  }
}

export function expiresAtFromExpiresIn(expiresIn: number | null, now = Date.now()): number {
  const sec = expiresIn && expiresIn > 0 ? expiresIn : MCP_ACCESS_DEFAULT_TTL_SEC
  return now + sec * 1000
}

export function parseMcpSecretPayload(json: string): McpSecretPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    if (MCP_OAUTH_PAYLOAD_KEYS.has(key)) continue
    if (typeof value === "string" && value.length > 0) headers[key] = value
  }
  const refresh = readString(record, "refresh_token")
  const tokenEndpoint = readString(record, "token_endpoint")
  const clientId = readString(record, "client_id")
  const resource = readString(record, "resource")
  const rawExpires = record.expires_at
  const expiresAt = typeof rawExpires === "number" && Number.isFinite(rawExpires) ? rawExpires : null
  const secret = readString(record, "client_secret")
  const oauth =
    refresh && tokenEndpoint && clientId && resource && expiresAt !== null
      ? {
          refresh_token: refresh,
          expires_at: expiresAt,
          token_endpoint: tokenEndpoint,
          client_id: clientId,
          client_secret: secret.length > 0 ? secret : null,
          resource,
        }
      : null
  return { headers, oauth }
}

export function mcpHttpHeaders(payload: McpSecretPayload | null): Record<string, string> | undefined {
  if (payload === null || Object.keys(payload.headers).length === 0) return undefined
  return payload.headers
}

export function shouldRefreshMcpAccess(oauth: McpOauthFields | null, now = Date.now()): boolean {
  if (!oauth?.refresh_token || !oauth.token_endpoint || !oauth.client_id) return false
  return oauth.expires_at - MCP_ACCESS_SKEW_MS <= now
}

export function serializeMcpSecretPayload(args: {
  accessToken: string
  oauth: {
    refreshToken: string | null
    expiresAt: number
    tokenEndpoint: string
    clientId: string
    clientSecret: string | null
    resource: string
  } | null
}): string {
  const body: Record<string, string | number> = {
    Authorization: `Bearer ${args.accessToken}`,
  }
  if (args.oauth?.refreshToken) {
    body.refresh_token = args.oauth.refreshToken
    body.expires_at = args.oauth.expiresAt
    body.token_endpoint = args.oauth.tokenEndpoint
    body.client_id = args.oauth.clientId
    if (args.oauth.clientSecret) body.client_secret = args.oauth.clientSecret
    body.resource = args.oauth.resource
  }
  return JSON.stringify(body)
}

export function prefersStreamableHttp(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.toLowerCase() === "mcp.make.com") return true
    const path = parsed.pathname.replace(/\/$/, "").toLowerCase()
    return path.endsWith("/mcp") || path.endsWith("/stateless") || path.endsWith("/stream")
  } catch {
    return false
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

function uniqueUrls(urls: Array<string | null>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const url of urls) {
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

async function probeResourceMetadataUrl(mcpUrl: string): Promise<string | null> {
  try {
    const response = await fetch(mcpUrl, {
      headers: { accept: "application/json, text/event-stream" },
    })
    return parseWwwAuthenticateResourceMetadata(response.headers.get("www-authenticate"))
  } catch {
    return null
  }
}

export async function discoverMcpOAuth(mcpUrl: string): Promise<{
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
  tokenEndpointAuthMethod: "none" | "client_secret_post"
  resource: string
  scope: string
}> {
  const parsed = new URL(mcpUrl)
  let resource = mcpUrl.replace(/\/$/, "")
  let scope = ""
  let issuers: string[] = []
  const prmUrls = uniqueUrls([
    await probeResourceMetadataUrl(mcpUrl),
    ...wellKnownMetadataUrls(mcpUrl, "oauth-protected-resource"),
  ])
  for (const prmUrl of prmUrls) {
    const prm = await fetchJson(prmUrl)
    if (prm === null) continue
    const fromPrm = parsePrmResource(prm)
    if (fromPrm) resource = fromPrm
    const servers = parseAuthorizationServers(prm)
    if (servers.length > 0) issuers = servers
    const fromScopes = parseScopesSupported(prm)
    if (fromScopes) scope = fromScopes
    if (fromPrm || servers.length > 0) break
  }
  if (issuers.length === 0) issuers = [parsed.origin]
  const asUrls = uniqueUrls([
    ...issuers.flatMap((issuer) => wellKnownMetadataUrls(issuer, "oauth-authorization-server")),
    ...wellKnownMetadataUrls(parsed.origin, "oauth-authorization-server"),
  ])
  for (const asUrl of asUrls) {
    const json = await fetchJson(asUrl)
    const meta = parseAsMetadata(json)
    if (meta === null) continue
    if (!scope) scope = parseScopesSupported(json)
    return { ...meta, resource, scope }
  }
  throw new Error("MCP_OAUTH")
}

export async function registerMcpClient(args: {
  registrationEndpoint: string
  redirectUri: string
  clientName: string
  tokenEndpointAuthMethod?: "none" | "client_secret_post"
}): Promise<{ clientId: string; clientSecret: string | null }> {
  const response = await fetch(args.registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: args.clientName,
      redirect_uris: [args.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: args.tokenEndpointAuthMethod ?? "client_secret_post",
    }),
  })
  if (!response.ok) throw new Error("MCP_OAUTH")
  const client = parseRegisteredClient(await response.json())
  if (client === null) throw new Error("MCP_OAUTH")
  return client
}

export async function exchangeMcpAuthorizationCode(args: {
  tokenEndpoint: string
  code: string
  clientId: string
  clientSecret: string | null
  redirectUri: string
  verifier: string
  resource: string
}): Promise<McpTokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    code_verifier: args.verifier,
    resource: args.resource,
  })
  if (args.clientSecret) body.set("client_secret", args.clientSecret)
  const response = await fetch(args.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!response.ok) throw new Error("MCP_OAUTH")
  const tokens = parseTokenResponse(await response.json())
  if (tokens === null) throw new Error("MCP_OAUTH")
  return tokens
}

export async function refreshMcpAccessToken(args: {
  tokenEndpoint: string
  refreshToken: string
  clientId: string
  clientSecret: string | null
  resource: string
}): Promise<McpTokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
    resource: args.resource,
  })
  if (args.clientSecret) body.set("client_secret", args.clientSecret)
  const response = await fetch(args.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!response.ok) throw new Error("MCP_OAUTH")
  const tokens = parseTokenResponse(await response.json())
  if (tokens === null) throw new Error("MCP_OAUTH")
  return tokens
}

export type OauthSessionPayload = {
  verifier: string
  clientId: string
  clientSecret: string | null
  tokenEndpoint: string
  redirectUri: string
  resource: string
}

export function parseOauthSessionPayload(json: string): OauthSessionPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const verifier = readString(parsed, "verifier")
  const clientId = readString(parsed, "clientId")
  const tokenEndpoint = readString(parsed, "tokenEndpoint")
  const redirectUri = readString(parsed, "redirectUri")
  const resource = readString(parsed, "resource")
  if (!verifier || !clientId || !tokenEndpoint || !redirectUri || !resource) return null
  const secret = readString(parsed, "clientSecret")
  return {
    verifier,
    clientId,
    clientSecret: secret.length > 0 ? secret : null,
    tokenEndpoint,
    redirectUri,
    resource,
  }
}

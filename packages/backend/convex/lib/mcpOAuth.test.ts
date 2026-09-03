import { afterEach, expect, test, vi } from "vitest"
import {
  MCP_OAUTH_CALLBACK_PATH,
  buildMcpAuthorizeUrl,
  discoverMcpOAuth,
  exchangeMcpAuthorizationCode,
  mcpHttpHeaders,
  mcpOAuthRedirectUri,
  parseAsMetadata,
  parseMcpSecretPayload,
  parseRegisteredClient,
  parseTokenResponse,
  parseWwwAuthenticateResourceMetadata,
  prefersStreamableHttp,
  refreshMcpAccessToken,
  registerMcpClient,
  shouldRefreshMcpAccess,
  wellKnownMetadataUrls,
} from "./mcpOAuth"

afterEach(() => {
  vi.unstubAllGlobals()
})

test("redirect localhost : callback admin", () => {
  expect(mcpOAuthRedirectUri("http://localhost:3001")).toBe(
    `http://localhost:3001${MCP_OAUTH_CALLBACK_PATH}`,
  )
})

test("buildMcpAuthorizeUrl pose les params que Fastify exige", () => {
  const url = buildMcpAuthorizeUrl({
    authorizationEndpoint: "https://www.make.com/oauth/v2/authorize",
    clientId: "client-dcr",
    redirectUri: "http://localhost:3001/api/connectors/mcp/callback",
    state: "etat",
    codeChallenge: "challenge",
    resource: "https://mcp.make.com/",
  })
  const parsed = new URL(url)
  expect(parsed.searchParams.get("response_type")).toBe("code")
  expect(parsed.searchParams.get("client_id")).toBe("client-dcr")
  expect(parsed.searchParams.get("redirect_uri")).toBe(
    "http://localhost:3001/api/connectors/mcp/callback",
  )
  expect(parsed.searchParams.get("state")).toBe("etat")
  expect(parsed.searchParams.get("code_challenge")).toBe("challenge")
  expect(parsed.searchParams.get("code_challenge_method")).toBe("S256")
  expect(parsed.searchParams.get("resource")).toBe("https://mcp.make.com/")
})

test("parseAsMetadata accepte un document sans registration_endpoint", () => {
  const meta = parseAsMetadata({
    authorization_endpoint: "https://auth.example/authorize",
    token_endpoint: "https://auth.example/token",
  })
  expect(meta?.authorizationEndpoint).toBe("https://auth.example/authorize")
  expect(meta?.registrationEndpoint).toBe("")
})

test("WWW-Authenticate expose resource_metadata", () => {
  expect(
    parseWwwAuthenticateResourceMetadata(
      'Bearer realm="OAuth", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
    ),
  ).toBe("https://mcp.example.com/.well-known/oauth-protected-resource/mcp")
})

test("well-known path-aware puis origine", () => {
  expect(wellKnownMetadataUrls("https://mcp.example.com/mcp", "oauth-protected-resource")).toEqual([
    "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
    "https://mcp.example.com/.well-known/oauth-protected-resource",
  ])
})

test("découverte : 401 → PRM → AS, resource path-aware, pas de client_id inventé", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url === "https://mcp.example.com/mcp") {
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
        },
      })
    }
    if (url.endsWith("/oauth-protected-resource/mcp")) {
      return new Response(
        JSON.stringify({
          resource: "https://mcp.example.com/mcp",
          authorization_servers: ["https://mcp.example.com"],
          scopes_supported: ["default"],
        }),
        { status: 200 },
      )
    }
    if (url.endsWith("/oauth-authorization-server")) {
      return new Response(
        JSON.stringify({
          authorization_endpoint: "https://mcp.example.com/authorize",
          token_endpoint: "https://mcp.example.com/token",
          registration_endpoint: "https://mcp.example.com/register",
          token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
        }),
        { status: 200 },
      )
    }
    return new Response("no", { status: 404 })
  })
  vi.stubGlobal("fetch", fetchMock)
  const discovered = await discoverMcpOAuth("https://mcp.example.com/mcp")
  expect(discovered.authorizationEndpoint).toBe("https://mcp.example.com/authorize")
  expect(discovered.tokenEndpoint).toBe("https://mcp.example.com/token")
  expect(discovered.registrationEndpoint).toBe("https://mcp.example.com/register")
  expect(discovered.resource).toBe("https://mcp.example.com/mcp")
  expect(discovered.scope).toBe("default")
  expect(discovered.tokenEndpointAuthMethod).toBe("none")
  expect(fetchMock.mock.calls[0]?.[0]).toBe("https://mcp.example.com/mcp")
})

test("registerMcpClient lit le client_id DCR, ne l'invente pas", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(
      JSON.stringify({ client_id: "issu-par-le-serveur", client_secret: "s" }),
      { status: 201 },
    )
  })
  vi.stubGlobal("fetch", fetchMock)
  const client = await registerMcpClient({
    registrationEndpoint: "https://auth.example/register",
    redirectUri: "http://localhost:3001/api/connectors/mcp/callback",
    clientName: "AstroTan",
  })
  expect(client.clientId).toBe("issu-par-le-serveur")
  const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
    redirect_uris: string[]
  }
  expect(body.redirect_uris).toEqual([
    "http://localhost:3001/api/connectors/mcp/callback",
  ])
  expect(parseRegisteredClient({ client_id: "" })).toBe(null)
})

test("exchangeMcpAuthorizationCode envoie PKCE et redirect localhost", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(
      JSON.stringify({
        access_token: "tok",
        refresh_token: "ref",
        expires_in: 1200,
      }),
      { status: 200 },
    )
  })
  vi.stubGlobal("fetch", fetchMock)
  await expect(
    exchangeMcpAuthorizationCode({
      tokenEndpoint: "https://www.make.com/oauth/v2/token",
      code: "abc",
      clientId: "id",
      clientSecret: "sec",
      redirectUri: "http://localhost:3001/api/connectors/mcp/callback",
      verifier: "verif",
      resource: "https://mcp.make.com/",
    }),
  ).resolves.toEqual({
    accessToken: "tok",
    refreshToken: "ref",
    expiresIn: 1200,
  })
  const body = String(fetchMock.mock.calls[0]?.[1]?.body)
  expect(body).toContain("code_verifier=verif")
  expect(body).toContain("redirect_uri=http")
  expect(body).toContain("localhost")
})

test("parseTokenResponse lit access, refresh et expires_in", () => {
  expect(
    parseTokenResponse({
      access_token: "acc",
      refresh_token: "ref",
      expires_in: 900,
    }),
  ).toEqual({ accessToken: "acc", refreshToken: "ref", expiresIn: 900 })
  expect(parseTokenResponse({ access_token: "acc" })).toEqual({
    accessToken: "acc",
    refreshToken: null,
    expiresIn: null,
  })
  expect(parseTokenResponse({ refresh_token: "ref" })).toBe(null)
})

test("refreshMcpAccessToken pose grant_type, resource, pas le code", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(
      JSON.stringify({ access_token: "acc2", refresh_token: "ref2", expires_in: 900 }),
      { status: 200 },
    )
  })
  vi.stubGlobal("fetch", fetchMock)
  await expect(
    refreshMcpAccessToken({
      tokenEndpoint: "https://www.make.com/oauth/v2/token",
      refreshToken: "ref",
      clientId: "id",
      clientSecret: "sec",
      resource: "https://mcp.make.com",
    }),
  ).resolves.toEqual({
    accessToken: "acc2",
    refreshToken: "ref2",
    expiresIn: 900,
  })
  const body = String(fetchMock.mock.calls[0]?.[1]?.body)
  expect(body).toContain("grant_type=refresh_token")
  expect(body).toContain("refresh_token=ref")
  expect(body).toContain("resource=")
  expect(body).not.toContain("code=")
})

test("le payload chiffré sépare les en-têtes HTTP des champs OAuth", () => {
  const payload = parseMcpSecretPayload(
    JSON.stringify({
      Authorization: "Bearer acc",
      refresh_token: "ref",
      expires_at: 1_700_000_000_000,
      token_endpoint: "https://www.make.com/oauth/v2/token",
      client_id: "id",
      client_secret: "sec",
      resource: "https://mcp.make.com",
    }),
  )
  expect(mcpHttpHeaders(payload)).toEqual({ Authorization: "Bearer acc" })
  expect(payload?.oauth?.refresh_token).toBe("ref")
  expect(shouldRefreshMcpAccess(payload?.oauth ?? null, 1_700_000_000_000)).toBe(true)
  expect(shouldRefreshMcpAccess(payload?.oauth ?? null, 1_699_000_000_000)).toBe(false)
})

test("un JSON legacy { Authorization } reste un Bearer, sans refresh", () => {
  const payload = parseMcpSecretPayload(JSON.stringify({ Authorization: "Bearer old" }))
  expect(mcpHttpHeaders(payload)).toEqual({ Authorization: "Bearer old" })
  expect(payload?.oauth).toBe(null)
  expect(shouldRefreshMcpAccess(null, Date.now())).toBe(false)
})

test("Make et /mcp sont du HTTP streamable, pas du SSE", () => {
  expect(prefersStreamableHttp("https://mcp.make.com")).toBe(true)
  expect(prefersStreamableHttp("https://mcp.make.com/")).toBe(true)
  expect(prefersStreamableHttp("https://mcp.notion.com/mcp")).toBe(true)
  expect(prefersStreamableHttp("https://legacy.example/sse")).toBe(false)
})

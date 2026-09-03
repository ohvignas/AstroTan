import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"
import { SECRETS_KEY_VAR } from "./lib/secretsCrypto"

const CLE_MAITRESSE = btoa(
  String.fromCharCode(...new Uint8Array(32).map((_, i) => (i * 7 + 13) % 251)),
)

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env[SECRETS_KEY_VAR] = CLE_MAITRESSE
  vi.stubGlobal("fetch", stubMakeOAuth())
})

afterEach(() => {
  process.env = originalEnv
  vi.unstubAllGlobals()
})

function stubMakeOAuth() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url.includes("oauth-authorization-server")) {
      return new Response(
        JSON.stringify({
          authorization_endpoint: "https://www.make.com/oauth/v2/authorize",
          token_endpoint: "https://www.make.com/oauth/v2/token",
          registration_endpoint: "https://www.make.com/oauth/v2/register/mcp",
        }),
        { status: 200 },
      )
    }
    if (url.includes("oauth-protected-resource")) {
      return new Response(JSON.stringify({ resource: "https://mcp.make.com/" }), {
        status: 200,
      })
    }
    if (url.includes("/register")) {
      return new Response(
        JSON.stringify({ client_id: "client-dcr", client_secret: "secret-dcr" }),
        { status: 201 },
      )
    }
    if (url.includes("/token")) {
      return new Response(
        JSON.stringify({
          access_token: "tok-access",
          refresh_token: "tok-refresh",
          expires_in: 1200,
        }),
        { status: 200 },
      )
    }
    return new Response("no", { status: 404 })
  })
}

async function seedAdmin() {
  const t = makeTestConvex()
  const email = `mcp-oauth-${Date.now()}@example.com`
  const password = "correct horse battery staple mcp oauth"
  const user = await seedUser(t, { email, password, name: "OAuth admin", role: "admin" })
  await signIn(t, email, password)
  return { t, identity: await identityFor(t, user.id) }
}

test("beginAuthorize construit l'URL complète, y compris redirect localhost", async () => {
  const { identity } = await seedAdmin()
  const id = await identity.mutation(api.mcpServers.create, {
    name: "Make",
    transport: "sse",
    url: "https://mcp.make.com",
  })
  const { url } = await identity.action(api.mcpOAuth.beginAuthorize, { id })
  const parsed = new URL(url)
  expect(parsed.origin + parsed.pathname).toBe("https://www.make.com/oauth/v2/authorize")
  expect(parsed.searchParams.get("response_type")).toBe("code")
  expect(parsed.searchParams.get("client_id")).toBe("client-dcr")
  expect(parsed.searchParams.get("redirect_uri")).toBe(
    `${ORIGIN}/api/connectors/mcp/callback`,
  )
  expect(parsed.searchParams.get("code_challenge_method")).toBe("S256")
  expect(parsed.searchParams.get("code_challenge")).toBeTruthy()
  expect(parsed.searchParams.get("state")).toBeTruthy()
  expect(parsed.searchParams.get("resource")).toBe("https://mcp.make.com/")
})

test("beginAuthorize refuse sans registration_endpoint (pas de client_id inventé)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url.includes("oauth-authorization-server")) {
        return new Response(
          JSON.stringify({
            authorization_endpoint: "https://auth.example/authorize",
            token_endpoint: "https://auth.example/token",
          }),
          { status: 200 },
        )
      }
      if (url.includes("oauth-protected-resource")) {
        return new Response(JSON.stringify({ resource: "https://mcp.example.com/mcp" }), {
          status: 200,
        })
      }
      return new Response("no", { status: 404 })
    }),
  )
  const { identity } = await seedAdmin()
  const id = await identity.mutation(api.mcpServers.create, {
    name: "sans-dcr",
    transport: "http",
    url: "https://mcp.example.com/mcp",
  })
  await expect(identity.action(api.mcpOAuth.beginAuthorize, { id })).rejects.toThrow()
})

test("un editor n'ouvre pas l'autorisation MCP", async () => {
  const t = makeTestConvex()
  const email = `mcp-oauth-ed-${Date.now()}@example.com`
  const password = "correct horse battery staple mcp oauth"
  const admin = await seedUser(t, { email: `adm-${email}`, password, name: "Adm", role: "admin" })
  await signIn(t, `adm-${email}`, password)
  const adminId = await identityFor(t, admin.id)
  const id = await adminId.mutation(api.mcpServers.create, {
    name: "Make",
    transport: "sse",
    url: "https://mcp.make.com",
  })
  const editor = await seedUser(t, { email, password, name: "Ed", role: "editor" })
  await signIn(t, email, password)
  const editorId = await identityFor(t, editor.id)
  await expect(editorId.action(api.mcpOAuth.beginAuthorize, { id })).rejects.toThrow()
})

test("exchangeCode range le bearer chiffré ; list ne le rend pas", async () => {
  const { identity } = await seedAdmin()
  const id = await identity.mutation(api.mcpServers.create, {
    name: "Make",
    transport: "sse",
    url: "https://mcp.make.com",
  })
  const { url } = await identity.action(api.mcpOAuth.beginAuthorize, { id })
  const state = new URL(url).searchParams.get("state") ?? ""
  await identity.action(api.mcpOAuth.exchangeCode, { code: "abc", state })
  const listed = await identity.query(api.mcpServers.list, {})
  expect(listed).toEqual([
    expect.objectContaining({ _id: id, headersConfigured: true }),
  ])
  expect(JSON.stringify(listed)).not.toContain("tok-access")
  expect(JSON.stringify(listed)).not.toContain("tok-refresh")
  expect(JSON.stringify(listed)).not.toContain("secret-dcr")
  expect(JSON.stringify(listed)).not.toContain("oauthChiffre")
})

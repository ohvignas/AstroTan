import { afterEach, beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
})

afterEach(() => {
  process.env = originalEnv
})

async function seedActor(role: "owner" | "admin" | "editor") {
  const t = makeTestConvex()
  const email = `mcp-${role}-${Date.now()}@example.com`
  const password = "correct horse battery staple mcp"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { t, identity: await identityFor(t, user.id) }
}

test("refuse transport stdio", async () => {
  const { identity } = await seedActor("admin")
  await expect(
    identity.mutation(api.mcpServers.create, {
      name: "x",
      transport: "stdio",
      url: "https://example.com/mcp",
    }),
  ).rejects.toMatchObject({ data: { code: "MCP_TRANSPORT" } })
})

test("refuse http non-localhost en prod", async () => {
  const { identity } = await seedActor("admin")
  await expect(
    identity.mutation(api.mcpServers.create, {
      name: "x",
      transport: "http",
      url: "http://evil.example/mcp",
    }),
  ).rejects.toMatchObject({ data: { code: "MCP_URL" } })
})

test("un editor ne crée pas de serveur", async () => {
  const { identity } = await seedActor("editor")
  await expect(
    identity.mutation(api.mcpServers.create, {
      name: "x",
      transport: "http",
      url: "https://example.com/mcp",
    }),
  ).rejects.toThrow()
})

test("create https puis list sans jamais rendre les en-têtes", async () => {
  const { identity } = await seedActor("admin")
  const id = await identity.mutation(api.mcpServers.create, {
    name: "support",
    transport: "http",
    url: "https://example.com/mcp",
  })
  const listed = await identity.query(api.mcpServers.list, {})
  expect(listed).toEqual([
    expect.objectContaining({
      _id: id,
      name: "support",
      headersConfigured: false,
    }),
  ])
  expect(JSON.stringify(listed)).not.toContain("Authorization")
})

test("create sse avec authorizeUrl, list la rend, jamais les en-têtes", async () => {
  const { identity } = await seedActor("admin")
  const id = await identity.mutation(api.mcpServers.create, {
    name: "composio",
    transport: "sse",
    url: "https://mcp.exemple.com/sse",
    authorizeUrl: "https://mcp.exemple.com/connect",
  })
  const listed = await identity.query(api.mcpServers.list, {})
  expect(listed).toEqual([
    expect.objectContaining({
      _id: id,
      name: "composio",
      transport: "sse",
      authorizeUrl: "https://mcp.exemple.com/connect",
      headersConfigured: false,
    }),
  ])
  expect(JSON.stringify(listed)).not.toContain("Authorization")
})

test("authorizeUrl http hors localhost est refusée", async () => {
  const { identity } = await seedActor("admin")
  await expect(
    identity.mutation(api.mcpServers.create, {
      name: "x",
      transport: "sse",
      url: "https://exemple.com/sse",
      authorizeUrl: "http://evil.example/connect",
    }),
  ).rejects.toMatchObject({ data: { code: "MCP_URL" } })
})

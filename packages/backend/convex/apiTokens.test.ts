import { afterEach, beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import { hashToken } from "./lib/token"
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
  const email = `api-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple api token"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { t, identity: await identityFor(t, user.id) }
}

test("generate montre le clair une fois et ne range que le hash et last3", async () => {
  const { t, identity } = await seedActor("owner")
  const out = await identity.mutation(api.apiTokens.generate, {})
  expect(out.token).toMatch(/^[0-9a-f]{64}$/)

  const rows = await t.run(async (ctx) => ctx.db.query("apiTokens").collect())
  expect(rows).toHaveLength(1)
  expect(rows[0]?.tokenHash).toBe(await hashToken(out.token))
  expect(rows[0]?.last3).toBe(out.token.slice(-3))
  expect(JSON.stringify(rows[0])).not.toContain(out.token)
})

test("status rend last3, ni hash ni clair", async () => {
  const { t, identity } = await seedActor("admin")
  const out = await identity.mutation(api.apiTokens.generate, {})
  const status = await identity.query(api.apiTokens.status, {})
  expect(status).toEqual({
    configured: true,
    createdAt: expect.any(Number),
    last3: out.token.slice(-3),
  })
  const dumped = JSON.stringify(status)
  expect(dumped).not.toContain(out.token)
  const row = await t.run(async (ctx) => (await ctx.db.query("apiTokens").collect())[0])
  expect(dumped).not.toContain(row?.tokenHash)
})

test("status rend last3 null pour une ligne sans suffixe", async () => {
  const { t, identity } = await seedActor("owner")
  await t.run(async (ctx) => {
    await ctx.db.insert("apiTokens", {
      tokenHash: "abc",
      createdBy: "u",
      createdAt: Date.now(),
    })
  })
  expect(await identity.query(api.apiTokens.status, {})).toEqual({
    configured: true,
    createdAt: expect.any(Number),
    last3: null,
  })
})

test("revoke efface la ligne", async () => {
  const { identity } = await seedActor("owner")
  await identity.mutation(api.apiTokens.generate, {})
  await identity.mutation(api.apiTokens.revoke, {})
  expect(await identity.query(api.apiTokens.status, {})).toEqual({
    configured: false,
    createdAt: null,
    last3: null,
  })
})

test("un editor ne génère pas", async () => {
  const { identity } = await seedActor("editor")
  await expect(identity.mutation(api.apiTokens.generate, {})).rejects.toThrow()
  await expect(identity.query(api.apiTokens.status, {})).rejects.toThrow()
})

test("generate remplace le jeton précédent", async () => {
  const { identity } = await seedActor("owner")
  const first = await identity.mutation(api.apiTokens.generate, {})
  const second = await identity.mutation(api.apiTokens.generate, {})
  expect(second.token).not.toBe(first.token)
  const status = await identity.query(api.apiTokens.status, {})
  expect(status.configured).toBe(true)
})

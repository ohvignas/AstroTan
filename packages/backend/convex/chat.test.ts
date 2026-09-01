import { afterEach, beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"
import type { TestConvex } from "convex-test"
import type schema from "./schema"

const SECRET = "s".repeat(32)

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env.LEAD_SUBMIT_SECRET = SECRET
  process.env.CHAT_SESSION_SECRET = "c".repeat(32)
})

afterEach(() => {
  process.env = originalEnv
})

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor",
) {
  const email = `chat-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple chat"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return await identityFor(t, user.id)
}

test("sans secret, chat.start refuse", async () => {
  const t = makeTestConvex()
  await expect(
    t.mutation(api.chat.start, { secret: "", email: "a@example.com", name: "Ada", origin: "aa" }),
  ).rejects.toThrow()
})

test("e-mail nouveau crée une fiche new source chat et un threadId", async () => {
  const t = makeTestConvex()
  const { token, leadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "ada@example.com",
    name: "Ada",
    origin: "ff".repeat(32),
  })
  expect(token.split(".").length).toBe(4)
  const lead = await t.run((ctx) => ctx.db.get(leadId))
  expect(lead?.status).toBe("new")
  expect(lead?.source).toBe("chat")
  expect(lead?.threadId).toEqual(expect.any(String))
})

test("e-mail déjà won ne repasse pas à new", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const EXISTING = "ada-won@example.com"
  await t.mutation(api.leads.submit, {
    secret: SECRET,
    name: "Ada",
    email: EXISTING,
    body: "Bonjour, je voudrais un devis.",
  })
  const firstId = await t.run(async (ctx) => {
    const row = await ctx.db
      .query("leads")
      .withIndex("by_email", (q) => q.eq("email", EXISTING))
      .unique()
    if (row === null) throw new Error("lead attendu après submit")
    return row._id
  })
  await admin.mutation(api.leads.move, { id: firstId, status: "won" })

  const again = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: EXISTING,
    name: "Ada",
    origin: "bb".repeat(32),
  })
  const lead = await t.run((ctx) => ctx.db.get(again.leadId))
  expect(lead?.status).toBe("won")
  expect(lead?._id).toBe(firstId)
})

test("e-mail invalide lève INVALID_EMAIL", async () => {
  const t = makeTestConvex()
  await expect(
    t.mutation(api.chat.start, {
      secret: SECRET,
      email: "pas-une-adresse",
      name: "Ada",
      origin: "cc".repeat(32),
    }),
  ).rejects.toMatchObject({ data: { code: "INVALID_EMAIL" } })
})

import { afterEach, beforeEach, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createThread } from "@convex-dev/agent"
import { convexTest, type TestConvex } from "convex-test"
import agentTest from "@convex-dev/agent/test"
import schema from "./schema"
import { api, components } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  modules,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"
let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env.LEAD_SUBMIT_SECRET = "s".repeat(32)
  process.env.CHAT_SESSION_SECRET = "c".repeat(32)
})

afterEach(() => {
  process.env = originalEnv
})

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor",
) {
  const email = `preview-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple preview"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return await identityFor(t, user.id)
}

test("chat.previewStart ne crée ni lead ni session visiteur", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  const started = await owner.mutation(api.chat.previewStart, {})

  expect(started.threadId).toEqual(expect.any(String))
  const leads = await t.run((ctx) => ctx.db.query("leads").collect())
  const sessions = await t.run((ctx) => ctx.db.query("chatSessions").collect())
  expect(leads).toEqual([])
  expect(sessions).toEqual([])
})

test("chat.previewSend ne crée pas de fiche lead", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const { threadId } = await admin.mutation(api.chat.previewStart, {})

  await admin.mutation(api.chat.previewSend, { threadId, body: "Test aperçu" })

  const leads = await t.run((ctx) => ctx.db.query("leads").collect())
  expect(leads).toEqual([])
})

test("sans session, previewStart refuse", async () => {
  const t = makeTestConvex()
  await expect(t.mutation(api.chat.previewStart, {})).rejects.toThrow()
})

test("previewListMessages lit le rôle sur le jeton, sans hop Better Auth", async () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "lib/chatPreview.ts"),
    "utf8",
  )
  const listFn = source.slice(
    source.indexOf("export async function listPreviewMessages"),
    source.indexOf("export async function resetPreviewChat"),
  )
  expect(listFn).toContain("requireRoleFromIdentity")
  expect(listFn).not.toContain("await requireRole(")

  const t = convexTest(schema, modules)
  agentTest.register(t)
  const threadId = await t.run(async (ctx) => {
    const id = await createThread(ctx, components.agent, {
      userId: "u_admin",
      title: "preview",
    })
    await ctx.db.insert("agentPreviewSessions", {
      threadId: id,
      userId: "u_admin",
      createdAt: Date.now(),
    })
    return id
  })
  const page = await t
    .withIdentity({ subject: "u_admin", role: "admin" })
    .query(api.chat.previewListMessages, {
      threadId,
      paginationOpts: { numItems: 10, cursor: null },
      streamArgs: { kind: "list" },
    })
  expect(page.page ?? []).toEqual([])
})

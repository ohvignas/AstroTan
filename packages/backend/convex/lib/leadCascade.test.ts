import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, components } from "../_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../../testing/betterAuthFixture"
import type { TestConvex } from "convex-test"
import type schema from "../schema"
import { deleteLeadCascade } from "./leadCascade"

const SECRET = "s".repeat(32)

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env.LEAD_SUBMIT_SECRET = SECRET
  process.env.CHAT_SESSION_SECRET = "c".repeat(32)
  vi.useFakeTimers()
})

afterEach(() => {
  process.env = originalEnv
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function seedActor(t: TestConvex<typeof schema>) {
  const email = `cascade-admin-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple cascade"
  const user = await seedUser(t, { email, password, name: "Admin cascade", role: "admin" })
  await signIn(t, email, password)
  return await identityFor(t, user.id)
}

test("deleteLeadCascade supprime session, présence et thread du chat", async () => {
  const t = makeTestConvex()
  const { leadId, threadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "cascade-chat@example.com",
    name: "Ada",
    origin: "aa".repeat(32),
  })

  await t.run(async (ctx) => {
    await ctx.db.insert("chatPresence", {
      threadId,
      actorId: "visitor",
      lastSeenAt: Date.now(),
    })
  })

  const avant = await t.query(components.agent.threads.getThread, { threadId })
  expect(avant).not.toBeNull()

  await t.run(async (ctx) => {
    await deleteLeadCascade(ctx, leadId)
  })
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  const sessions = await t.run((ctx) =>
    ctx.db
      .query("chatSessions")
      .withIndex("by_lead", (q) => q.eq("leadId", leadId))
      .collect(),
  )
  expect(sessions).toEqual([])

  const presence = await t.run((ctx) =>
    ctx.db
      .query("chatPresence")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .collect(),
  )
  expect(presence).toEqual([])

  const thread = await t.query(components.agent.threads.getThread, { threadId })
  expect(thread).toBeNull()
})

test("leads.remove passe par la cascade et efface le thread", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t)
  const { leadId, threadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "cascade-remove@example.com",
    name: "Ada",
    origin: "bb".repeat(32),
  })

  await admin.mutation(api.leads.remove, { id: leadId })
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  expect(await t.query(components.agent.threads.getThread, { threadId })).toBeNull()
  const sessions = await t.run((ctx) =>
    ctx.db
      .query("chatSessions")
      .withIndex("by_lead", (q) => q.eq("leadId", leadId))
      .collect(),
  )
  expect(sessions).toEqual([])
})

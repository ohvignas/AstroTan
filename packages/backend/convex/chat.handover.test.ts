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
  const email = `handover-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple handover"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return await identityFor(t, user.id)
}

async function startChatLead(t: TestConvex<typeof schema>) {
  const started = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: `handover-${Date.now()}@example.com`,
    name: "Ada",
    origin: "aa".repeat(32),
  })
  if (!started.leadId) throw new Error("lead attendu")
  return { ...started, leadId: started.leadId }
}

test("takeOver pose controller staff et un leadEvent handover", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const { leadId } = await startChatLead(t)

  await admin.mutation(api.chatStaff.takeOver, { leadId })

  const lead = await t.run((ctx) => ctx.db.get(leadId))
  expect(lead?.controller).toBe("staff")
  const events = await t.run((ctx) =>
    ctx.db
      .query("leadEvents")
      .withIndex("by_lead", (q) => q.eq("leadId", leadId))
      .collect(),
  )
  const handover = events.find((event) => event.type === "handover")
  expect(handover).toMatchObject({ from: "ai", to: "staff" })
  expect(handover?.actorName).toEqual(expect.any(String))
})

test("un editor peut prendre la main", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const { leadId } = await startChatLead(t)
  await editor.mutation(api.chatStaff.takeOver, { leadId })
  const lead = await t.run((ctx) => ctx.db.get(leadId))
  expect(lead?.controller).toBe("staff")
})

test("après takeover, send visiteur n'appelle pas stream", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const { token, leadId } = await startChatLead(t)
  await admin.mutation(api.chatStaff.takeOver, { leadId })
  const before = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
  await t.mutation(api.chat.send, {
    secret: SECRET,
    token,
    body: "besoin d'un humain",
  })
  const after = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
  const streamJobs = (jobs: typeof after) =>
    jobs.filter((job) => job.name.includes("chatStream.stream"))
  expect(streamJobs(after).length).toBe(streamJobs(before).length)
})

test("releaseToAi rend controller ai", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const { leadId } = await startChatLead(t)
  await admin.mutation(api.chatStaff.takeOver, { leadId })
  await admin.mutation(api.chatStaff.releaseToAi, { leadId })
  const lead = await t.run((ctx) => ctx.db.get(leadId))
  expect(lead?.controller).toBe("ai")
  const events = await t.run((ctx) =>
    ctx.db
      .query("leadEvents")
      .withIndex("by_lead", (q) => q.eq("leadId", leadId))
      .collect(),
  )
  expect(events.filter((event) => event.type === "handover")).toHaveLength(2)
})

test("sans session, takeOver refuse", async () => {
  const t = makeTestConvex()
  const { leadId } = await startChatLead(t)
  await expect(t.mutation(api.chatStaff.takeOver, { leadId })).rejects.toThrow()
})

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

async function seedActor(t: TestConvex<typeof schema>, role: "owner" | "admin" | "editor") {
  const email = `staff-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple staff"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return await identityFor(t, user.id)
}

async function startChatLead(t: TestConvex<typeof schema>) {
  const started = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: `staff-${Date.now()}@example.com`,
    name: "Ada",
    origin: "bb".repeat(32),
  })
  if (!started.leadId) throw new Error("lead attendu")
  return { ...started, leadId: started.leadId }
}

test("listStaffMessages sans session refuse", async () => {
  const t = makeTestConvex()
  await expect(
    t.query(api.chatStaff.listStaffMessages, {
      threadId: "thread-inconnu",
      paginationOpts: { numItems: 10, cursor: null },
      streamArgs: { kind: "list" },
    }),
  ).rejects.toThrow()
})

test("listStaffMessages refuse un thread qui n'appartient à aucune fiche", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  await expect(
    admin.query(api.chatStaff.listStaffMessages, {
      threadId: "thread-orphelin",
      paginationOpts: { numItems: 10, cursor: null },
      streamArgs: { kind: "list" },
    }),
  ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } })
})

test("staffReply enregistre un message assistant", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const { leadId, threadId } = await startChatLead(t)
  const result = await admin.mutation(api.chatStaff.staffReply, {
    leadId,
    body: "Je prends le relais.",
  })
  expect(result.messageId).toEqual(expect.any(String))
  const listed = await admin.query(api.chatStaff.listStaffMessages, {
    threadId,
    paginationOpts: { numItems: 10, cursor: null },
    streamArgs: { kind: "list" },
  })
  expect(listed.page.length).toBeGreaterThan(0)
})

test("staffReply après un assistant est un second message, pas une concaténation", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const { leadId, threadId } = await startChatLead(t)
  const { saveMessage } = await import("@convex-dev/agent")
  const { components } = await import("./_generated/api")
  await t.run(async (ctx) => {
    await saveMessage(ctx, components.agent, {
      threadId,
      agentName: "Assistant",
      message: { role: "assistant", content: "Que souhaitez-vous savoir ?" },
    })
  })
  const staff = await admin.mutation(api.chatStaff.staffReply, {
    leadId,
    body: "Vous avez besoins d'aide ?",
  })
  const listed = await admin.query(api.chatStaff.listStaffMessages, {
    threadId,
    paginationOpts: { numItems: 10, cursor: null },
    streamArgs: { kind: "list" },
  })
  const assistants = listed.page.filter((message) => message.role === "assistant")
  const texts = assistants.map((message) => message.text)
  expect(texts).toContain("Que souhaitez-vous savoir ?")
  expect(texts).toContain("Vous avez besoins d'aide ?")
  expect(texts.some((text) => text.includes("savoir ?Vous"))).toBe(false)
  expect(assistants).toHaveLength(2)
  expect(new Set(assistants.map((message) => message.id)).size).toBe(2)
  expect(staff.messageId).toEqual(expect.any(String))
})

test("staffHeartbeat puis presence voit le conseiller en ligne", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const { threadId, token, leadId } = await startChatLead(t)
  await admin.mutation(api.chatStaff.staffHeartbeat, { threadId })
  const beforeVisitor = await admin.query(api.chatStaff.presence, { threadId })
  expect(beforeVisitor.staffOnline).toBe(true)
  expect(beforeVisitor.visitorOnline).toBe(false)
  expect(beforeVisitor.controller).toBe("ai")
  expect(beforeVisitor.leadId).toBe(leadId)

  const ping = await t.mutation(api.chat.visitorHeartbeat, { secret: SECRET, token })
  expect(ping.staffOnline).toBe(true)
  const afterVisitor = await admin.query(api.chatStaff.presence, { threadId })
  expect(afterVisitor.visitorOnline).toBe(true)
})

test("visitorHeartbeat sans jeton refuse", async () => {
  const t = makeTestConvex()
  await expect(
    t.mutation(api.chat.visitorHeartbeat, { secret: SECRET, token: "nope" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SESSION" } })
})

test("watchVisitorMessages sans jeton refuse", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.chat.watchVisitorMessages, { token: "nope" })).rejects.toMatchObject({
    data: { code: "INVALID_SESSION" },
  })
})

test("staffReply est visible via watchVisitorMessages sans secret", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const { token, leadId } = await startChatLead(t)
  await admin.mutation(api.chatStaff.staffReply, {
    leadId,
    body: "Je vous réponds tout de suite.",
  })
  const watched = await t.query(api.chat.watchVisitorMessages, { token })
  expect(watched.page.some((message) => message.text === "Je vous réponds tout de suite.")).toBe(
    true,
  )
})

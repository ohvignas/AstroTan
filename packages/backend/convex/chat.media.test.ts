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
  const email = `chat-media-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple chat media"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return await identityFor(t, user.id)
}

async function enableAgent(t: TestConvex<typeof schema>) {
  const owner = await seedActor(t, "owner")
  await owner.mutation(api.settings.updateAgent, { agentEnabled: true })
}

test("generateUploadUrl sans jeton refuse", async () => {
  const t = makeTestConvex()
  await expect(
    t.mutation(api.chat.generateUploadUrl, { secret: SECRET, token: "nope" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SESSION" } })
})

test("visiteur : image seule, puis le conseiller la voit", async () => {
  const t = makeTestConvex()
  await enableAgent(t)
  const admin = await seedActor(t, "admin")
  const { token, leadId, threadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "media-visitor@example.com",
    name: "Ada",
    origin: "mm".repeat(32),
  })
  const uploadUrl = await t.mutation(api.chat.generateUploadUrl, { secret: SECRET, token })
  expect(uploadUrl).toEqual(expect.any(String))

  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["png"], { type: "image/png" })),
  )
  const sent = await t.mutation(api.chat.send, {
    secret: SECRET,
    token,
    body: "",
    storageId,
    filename: "photo.png",
  })
  expect(sent.messageId).toEqual(expect.any(String))

  const visitor = await t.query(api.chat.listVisitorMessages, {
    secret: SECRET,
    token,
    paginationOpts: { numItems: 10, cursor: null },
    streamArgs: { kind: "list" },
  })
  const withFile = visitor.page.find((msg) => msg.chatFile)
  expect(withFile?.chatFile).toMatchObject({
    filename: "photo.png",
    mime: "image/png",
    url: expect.stringMatching(/^https?:|^blob:/),
  })
  expect(
    withFile?.parts?.some(
      (part) =>
        part.type === "file" &&
        typeof part.url === "string" &&
        part.url.length > 0,
    ),
  ).toBe(true)

  const staff = await admin.query(api.chatStaff.listStaffMessages, {
    threadId,
    paginationOpts: { numItems: 10, cursor: null },
    streamArgs: { kind: "list" },
  })
  expect(staff.page.some((msg) => msg.chatFile?.filename === "photo.png")).toBe(true)
  expect(leadId).toEqual(expect.any(String))
})

test("send refuse un SVG même déjà stocké", async () => {
  const t = makeTestConvex()
  await enableAgent(t)
  const { token } = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: "ss".repeat(32),
  })
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["<svg/>"], { type: "image/svg+xml" })),
  )
  await expect(
    t.mutation(api.chat.send, {
      secret: SECRET,
      token,
      body: "",
      storageId,
      filename: "x.svg",
    }),
  ).rejects.toMatchObject({ data: { code: "UNSUPPORTED_MIME" } })
})

test("staffReply avec image : le visiteur la voit", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const started = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "media-staff@example.com",
    name: "Ada",
    origin: "st".repeat(32),
  })
  if (!started.leadId) throw new Error("lead attendu")
  const { token, leadId } = started
  const uploadUrl = await admin.mutation(api.chatStaff.generateUploadUrl, {})
  expect(uploadUrl).toEqual(expect.any(String))
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["jpg"], { type: "image/jpeg" })),
  )
  await admin.mutation(api.chatStaff.staffReply, {
    leadId,
    body: "Voici le plan.",
    storageId,
    filename: "plan.jpg",
  })
  const visitor = await t.query(api.chat.listVisitorMessages, {
    secret: SECRET,
    token,
    paginationOpts: { numItems: 10, cursor: null },
    streamArgs: { kind: "list" },
  })
  expect(visitor.page.some((msg) => msg.chatFile?.filename === "plan.jpg")).toBe(true)

  const staff = await admin.query(api.chatStaff.listStaffMessages, {
    threadId: started.threadId,
    paginationOpts: { numItems: 10, cursor: null },
    streamArgs: { kind: "list" },
  })
  const withFile = staff.page.find((msg) => msg.chatFile?.filename === "plan.jpg")
  expect(withFile?.chatFile).toMatchObject({
    filename: "plan.jpg",
    mime: "image/jpeg",
    url: expect.stringMatching(/^https?:|^blob:/),
  })
  expect(
    withFile?.parts?.some(
      (part) =>
        part.type === "file" &&
        typeof part.url === "string" &&
        part.url.length > 0,
    ),
  ).toBe(true)
})

test("staffReply avec image après l'IA : le conseiller la voit aussi", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const started = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "media-staff-after-ai@example.com",
    name: "Ada",
    origin: "sa".repeat(32),
  })
  if (!started.leadId) throw new Error("lead attendu")
  const { saveMessage } = await import("@convex-dev/agent")
  const { components } = await import("./_generated/api")
  await t.run(async (ctx) => {
    await saveMessage(ctx, components.agent, {
      threadId: started.threadId,
      agentName: "Assistant",
      message: { role: "assistant", content: "Le bootcamp dure 8 semaines." },
    })
  })
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["jpg"], { type: "image/jpeg" })),
  )
  await admin.mutation(api.chatStaff.staffReply, {
    leadId: started.leadId,
    body: "voici le programme",
    storageId,
    filename: "plan.jpg",
  })
  const staff = await admin.query(api.chatStaff.listStaffMessages, {
    threadId: started.threadId,
    paginationOpts: { numItems: 10, cursor: null },
    streamArgs: { kind: "list" },
  })
  const withFile = staff.page.find((msg) => msg.chatFile?.filename === "plan.jpg")
  expect(withFile?.text).toContain("voici le programme")
  expect(withFile?.text).not.toContain("bootcamp")
  expect(
    withFile?.parts?.some(
      (part) => part.type === "file" && typeof part.url === "string" && part.url.length > 0,
    ),
  ).toBe(true)
})

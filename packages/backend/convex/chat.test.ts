import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
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
  vi.unstubAllGlobals()
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

test("start avec e-mail conserve IP et geo de confiance", async () => {
  const t = makeTestConvex()
  const { leadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "geo@example.com",
    name: "Ada",
    origin: "ff".repeat(32),
    ip: "203.0.113.42",
    country: "fr",
    city: "Lyon",
  })
  const lead = await t.run((ctx) => ctx.db.get(leadId))
  expect(lead).toMatchObject({
    ip: "203.0.113.42",
    country: "FR",
    city: "Lyon",
    source: "chat",
  })
})

test("attachEmail pose IP et geo sur la fiche créée", async () => {
  const t = makeTestConvex()
  const { token } = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: "cc".repeat(32),
  })
  const attached = await t.mutation(api.chat.attachEmail, {
    secret: SECRET,
    token,
    email: "geo-attach@example.com",
    origin: "cc".repeat(32),
    ip: "198.51.100.9",
    country: "DE",
    city: "Berlin",
  })
  const lead = await t.run((ctx) => ctx.db.get(attached.leadId))
  expect(lead).toMatchObject({
    ip: "198.51.100.9",
    country: "DE",
    city: "Berlin",
    source: "chat",
  })
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

test("send sans jeton refuse INVALID_SESSION", async () => {
  const t = makeTestConvex()
  await expect(
    t.mutation(api.chat.send, { secret: SECRET, token: "x", body: "bonjour" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SESSION" } })
})

test("send refuse AGENT_DISABLED si l'agent n'est pas allumé", async () => {
  const t = makeTestConvex()
  const { token } = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "disabled@example.com",
    name: "Ada",
    origin: "gg".repeat(32),
  })
  await expect(
    t.mutation(api.chat.send, { secret: SECRET, token, body: "bonjour" }),
  ).rejects.toMatchObject({ data: { code: "AGENT_DISABLED" } })
})

test("send planifie stream quand le contrôleur est l'IA", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.mutation(api.settings.updateAgent, { agentEnabled: true })
  const { token } = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "ai-ctrl@example.com",
    name: "Ada",
    origin: "hh".repeat(32),
  })
  const before = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
  await t.mutation(api.chat.send, { secret: SECRET, token, body: "bonjour" })
  const after = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
  const nouveaux = after.filter((job) => !before.some((b) => b._id === job._id))
  expect(nouveaux.map((job) => job.name).join(",")).toMatch(/stream/i)
})

test("send avec controller staff ne planifie pas stream", async () => {
  const t = makeTestConvex()
  const { token, leadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "staff-ctrl@example.com",
    name: "Ada",
    origin: "dd".repeat(32),
  })
  await t.run((ctx) => ctx.db.patch(leadId, { controller: "staff" }))
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

test("start sans e-mail ni IP ne crée pas de lead", async () => {
  const t = makeTestConvex()
  const started = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: "aa".repeat(32),
  })
  expect(started.leadId).toBeUndefined()
  expect(started.token.split(".").length).toBe(4)
  const leads = await t.run((ctx) => ctx.db.query("leads").collect())
  expect(leads).toHaveLength(0)
})

test("start sans e-mail avec IP crée une fiche identifiée par l'IP", async () => {
  const t = makeTestConvex()
  const started = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: "aa".repeat(32),
    ip: "203.0.113.42",
    country: "FR",
  })
  expect(started.leadId).toEqual(expect.any(String))
  const lead = await t.run((ctx) => ctx.db.get(started.leadId!))
  expect(lead).toMatchObject({
    name: "Visiteur",
    ip: "203.0.113.42",
    country: "FR",
    source: "chat",
  })
  expect(lead?.email).toBeUndefined()
})

test("deux starts la même IP sans e-mail restent une seule fiche", async () => {
  const t = makeTestConvex()
  const first = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: "aa".repeat(32),
    ip: "203.0.113.42",
  })
  const second = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: "bb".repeat(32),
    ip: "203.0.113.42",
  })
  expect(second.leadId).toBe(first.leadId)
  const leads = await t.run((ctx) => ctx.db.query("leads").collect())
  expect(leads).toHaveLength(1)
})

test("deux messages la même IP sans e-mail ne créent pas de second lead", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.mutation(api.settings.updateAgent, { agentEnabled: true })
  const { token, leadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: "bb".repeat(32),
    ip: "198.51.100.9",
  })
  await t.mutation(api.chat.send, { secret: SECRET, token, body: "premier" })
  await t.mutation(api.chat.send, { secret: SECRET, token, body: "deuxième" })
  const leads = await t.run((ctx) => ctx.db.query("leads").collect())
  expect(leads).toHaveLength(1)
  expect(leads[0]?._id).toBe(leadId)
  expect(leads[0]?.email).toBeUndefined()
  expect(leads[0]?.ip).toBe("198.51.100.9")
})

test("attachEmail sur une fiche IP ajoute l'e-mail, même fiche, IP déjà là", async () => {
  const t = makeTestConvex()
  const { token, leadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: "cc".repeat(32),
    ip: "203.0.113.42",
    country: "FR",
  })
  const attached = await t.mutation(api.chat.attachEmail, {
    secret: SECRET,
    token,
    email: "plus-tard@example.com",
    origin: "cc".repeat(32),
  })
  expect(attached.leadId).toBe(leadId)
  const lead = await t.run((ctx) => ctx.db.get(leadId!))
  expect(lead).toMatchObject({
    email: "plus-tard@example.com",
    ip: "203.0.113.42",
    country: "FR",
  })
  const leads = await t.run((ctx) => ctx.db.query("leads").collect())
  expect(leads).toHaveLength(1)
})

test("start avec e-mail écrit quand même l'IP et le pays", async () => {
  const t = makeTestConvex()
  const { leadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "avec-ip@example.com",
    name: "Ada",
    origin: "ff".repeat(32),
    ip: "203.0.113.42",
    country: "fr",
    city: "Lyon",
  })
  const lead = await t.run((ctx) => ctx.db.get(leadId))
  expect(lead).toMatchObject({
    email: "avec-ip@example.com",
    ip: "203.0.113.42",
    country: "FR",
    city: "Lyon",
  })
})

test("e-mail déjà connu autre IP : pas de doublon, l'IP récente s'écrit", async () => {
  const t = makeTestConvex()
  await t.mutation(api.leads.submit, {
    secret: SECRET,
    name: "Ada",
    email: "deja@example.com",
    body: "Bonjour depuis le formulaire.",
    ip: "198.51.100.1",
  })
  const { leadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "deja@example.com",
    name: "Ada",
    origin: "ee".repeat(32),
    ip: "203.0.113.99",
    country: "DE",
  })
  const leads = await t.run((ctx) => ctx.db.query("leads").collect())
  expect(leads).toHaveLength(1)
  expect(leads[0]?._id).toBe(leadId)
  expect(leads[0]).toMatchObject({
    email: "deja@example.com",
    ip: "203.0.113.99",
    country: "DE",
  })
})

test("attachEmail d'un e-mail déjà connu absorbe la fiche IP", async () => {
  const t = makeTestConvex()
  await t.mutation(api.leads.submit, {
    secret: SECRET,
    name: "Ada",
    email: "fusion@example.com",
    body: "Formulaire d'abord.",
    ip: "198.51.100.2",
  })
  const { token, leadId: ipLeadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: "gg".repeat(32),
    ip: "203.0.113.77",
  })
  const attached = await t.mutation(api.chat.attachEmail, {
    secret: SECRET,
    token,
    email: "fusion@example.com",
    origin: "gg".repeat(32),
    ip: "203.0.113.77",
  })
  expect(attached.leadId).not.toBe(ipLeadId)
  const leads = await t.run((ctx) => ctx.db.query("leads").collect())
  expect(leads).toHaveLength(1)
  expect(leads[0]?._id).toBe(attached.leadId)
  expect(leads[0]?.email).toBe("fusion@example.com")
  expect(leads[0]?.ip).toBe("203.0.113.77")
})

test("attachEmail sur une fiche déjà identifiée écrit quand même l'IP", async () => {
  const t = makeTestConvex()
  const { token, leadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "skip-ip@example.com",
    name: "Ada",
    origin: "hh".repeat(32),
  })
  await t.mutation(api.chat.attachEmail, {
    secret: SECRET,
    token,
    email: "autre@example.com",
    origin: "hh".repeat(32),
    ip: "203.0.113.55",
    country: "IT",
  })
  const lead = await t.run((ctx) => ctx.db.get(leadId))
  expect(lead).toMatchObject({
    email: "skip-ip@example.com",
    ip: "203.0.113.55",
    country: "IT",
  })
})

test("start sans e-mail n'épuise pas le quota du formulaire (5/h)", async () => {
  const t = makeTestConvex()
  const origine = "reset-origin".padEnd(64, "x")
  for (let n = 0; n < 5; n++) {
    await t.mutation(api.leads.submit, {
      secret: SECRET,
      origin: origine,
      name: `Visiteur ${n}`,
      email: `reset-lead-${n}@exemple.fr`,
      body: "Bonjour, j'aimerais des informations.",
    })
  }
  const started = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: origine,
  })
  expect(started.token.split(".").length).toBe(4)
  expect(started.leadId).toBeUndefined()
})

test("send sans e-mail fonctionne quand l'agent est allumé", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.mutation(api.settings.updateAgent, { agentEnabled: true })
  const { token } = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: "bb".repeat(32),
  })
  const result = await t.mutation(api.chat.send, {
    secret: SECRET,
    token,
    body: "bonjour sans email",
  })
  expect(result.messageId).toEqual(expect.any(String))
  const leads = await t.run((ctx) => ctx.db.query("leads").collect())
  expect(leads).toHaveLength(0)
})

test("start avec 127.0.0.1 écrit l'IP loopback, pas vide", async () => {
  const t = makeTestConvex()
  const { leadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: "ll".repeat(32),
    ip: "127.0.0.1",
  })
  expect(leadId).toEqual(expect.any(String))
  const lead = await t.run((ctx) => ctx.db.get(leadId!))
  expect(lead?.ip).toBe("127.0.0.1")
  expect(lead?.email).toBeUndefined()
})

test("fiche IP sans e-mail : listVisitorMessages ne pose pas hasLead", async () => {
  const t = makeTestConvex()
  const { token, leadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: "ii".repeat(32),
    ip: "203.0.113.42",
  })
  expect(leadId).toEqual(expect.any(String))
  const listed = await t.query(api.chat.listVisitorMessages, {
    secret: SECRET,
    token,
    paginationOpts: { numItems: 10, cursor: null },
    streamArgs: { kind: "list" },
  })
  expect(listed.hasLead).toBe(false)
  await t.mutation(api.chat.attachEmail, {
    secret: SECRET,
    token,
    email: "plus-tard@example.com",
    origin: "ii".repeat(32),
  })
  const after = await t.query(api.chat.listVisitorMessages, {
    secret: SECRET,
    token,
    paginationOpts: { numItems: 10, cursor: null },
    streamArgs: { kind: "list" },
  })
  expect(after.hasLead).toBe(true)
})

test("attachEmail crée un lead et listVisitorMessages le signale", async () => {
  const t = makeTestConvex()
  const { token } = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: "cc".repeat(32),
  })
  const before = await t.query(api.chat.listVisitorMessages, {
    secret: SECRET,
    token,
    paginationOpts: { numItems: 10, cursor: null },
    streamArgs: { kind: "list" },
  })
  expect(before.hasLead).toBe(false)
  const attached = await t.mutation(api.chat.attachEmail, {
    secret: SECRET,
    token,
    email: "apres@example.com",
    origin: "cc".repeat(32),
  })
  expect(attached.leadId).toEqual(expect.any(String))
  const leads = await t.run((ctx) => ctx.db.query("leads").collect())
  expect(leads).toHaveLength(1)
  expect(leads[0]?.email).toBe("apres@example.com")
  const after = await t.query(api.chat.listVisitorMessages, {
    secret: SECRET,
    token,
    paginationOpts: { numItems: 10, cursor: null },
    streamArgs: { kind: "list" },
  })
  expect(after.hasLead).toBe(true)
})

test("attachEmail est idempotent si le lead est déjà lié", async () => {
  const t = makeTestConvex()
  const { token } = await t.mutation(api.chat.start, {
    secret: SECRET,
    origin: "ee".repeat(32),
  })
  const first = await t.mutation(api.chat.attachEmail, {
    secret: SECRET,
    token,
    email: "once@example.com",
    origin: "ee".repeat(32),
  })
  const second = await t.mutation(api.chat.attachEmail, {
    secret: SECRET,
    token,
    email: "autre@example.com",
    origin: "ee".repeat(32),
  })
  expect(second.leadId).toBe(first.leadId)
  const leads = await t.run((ctx) => ctx.db.query("leads").collect())
  expect(leads).toHaveLength(1)
})

test("listVisitorMessages sans jeton refuse", async () => {
  const t = makeTestConvex()
  await expect(
    t.query(api.chat.listVisitorMessages, {
      secret: SECRET,
      token: "nope",
      paginationOpts: { numItems: 10, cursor: null },
      streamArgs: { kind: "list" },
    }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SESSION" } })
})

test("stream sans clé OpenRouter lève AGENT_UNCONFIGURED et n'appelle pas le réseau", async () => {
  delete process.env.OPENROUTER_API_KEY
  const fetchSpy = vi.fn()
  vi.stubGlobal("fetch", fetchSpy)
  const t = makeTestConvex()
  const { threadId } = await t.mutation(api.chat.start, {
    secret: SECRET,
    email: "no-key@example.com",
    name: "Ada",
    origin: "ee".repeat(32),
  })
  await expect(
    t.action(internal.chatStream.stream, { threadId, promptMessageId: "missing" }),
  ).rejects.toMatchObject({ data: { code: "AGENT_UNCONFIGURED" } })
  expect(fetchSpy).not.toHaveBeenCalled()
})

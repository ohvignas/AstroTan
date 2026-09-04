import { convexTest } from "convex-test"
import { expect, test } from "vitest"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

test("le schéma accepte un profil valide", async () => {
  const t = convexTest(schema, modules)
  const id = await t.run(async (ctx) =>
    ctx.db.insert("profiles", { authUserId: "user_1", displayName: "Flo" }),
  )
  const doc = await t.run(async (ctx) => ctx.db.get(id))
  expect(doc?.authUserId).toBe("user_1")
})

// Minor (Lot 1 final review): the previous version of this test asserted
// `not.toHaveProperty("role")` on a document its own insert never gave a
// `role` — a tautology of its own setup, not a check that the schema
// itself has anything to say about it. Asserted here directly against the
// schema's own field definition instead — the actual claim CLAUDE.md's
// invariant #4 makes ("le rôle vit sur l'utilisateur Better Auth, jamais
// dupliqué côté application") is about `defineTable`'s declared fields,
// not about what any one test happened to write.
test("le schéma de profils ne déclare pas de champ role — il vit sur l'utilisateur Better Auth", () => {
  expect(Object.keys(schema.tables.profiles.validator.fields)).not.toContain("role")
})

// The other half of the same claim: a document that *does* carry `role`
// is rejected outright by Convex's own schema validation, not silently
// accepted with the extra field ignored.
test("pages et posts déclarent targetKeyword ; settings déclare le lieu SERP", () => {
  expect(Object.keys(schema.tables.pages.validator.fields)).toContain("targetKeyword")
  expect(Object.keys(schema.tables.posts.validator.fields)).toContain("targetKeyword")
  expect(Object.keys(schema.tables.settings.validator.fields)).toContain(
    "serpLocationCode",
  )
  expect(Object.keys(schema.tables.settings.validator.fields)).toContain(
    "serpLanguageCode",
  )
  expect(Object.keys(schema.tables.settings.validator.fields)).toContain(
    "openRouterModel",
  )
  expect(Object.keys(schema.tables.settings.validator.fields)).toContain(
    "openRouterAgentModel",
  )
  expect(Object.keys(schema.tables.settings.validator.fields)).toContain(
    "openRouterImageModel",
  )
  expect(Object.keys(schema.tables.settings.validator.fields)).toContain(
    "openRouterOcrModel",
  )
})

test("les trois tables DataForSEO existent avec leurs index", () => {
  expect(schema.tables.seoRanks).toBeDefined()
  expect(schema.tables.seoSiteKeywords).toBeDefined()
  expect(schema.tables.seoSiteBacklinks).toBeDefined()
  const indexNames = schema.tables.seoRanks.indexes.map((idx) => idx.indexDescriptor)
  expect(indexNames).toEqual(expect.arrayContaining(["by_page", "by_post"]))
})

test("notificationPrefs et notifications existent avec leurs index", () => {
  expect(schema.tables.notificationPrefs).toBeDefined()
  expect(schema.tables.notifications).toBeDefined()
  const prefs = schema.tables.notificationPrefs.indexes.map((i) => i.indexDescriptor)
  const cloches = schema.tables.notifications.indexes.map((i) => i.indexDescriptor)
  expect(prefs).toEqual(expect.arrayContaining(["by_user_cle", "by_user"]))
  expect(cloches).toEqual(expect.arrayContaining(["by_user", "by_lead", "by_post"]))
})

test("seoSiteHistory historise un relevé par fetch", () => {
  expect(schema.tables.seoSiteHistory).toBeDefined()
  const champs = Object.keys(schema.tables.seoSiteHistory.validator.fields)
  expect(champs).toEqual(expect.arrayContaining(["metric", "value", "fetchedAt"]))
})

test("agentKnowledgeFiles.ocrPage et ocrTotal sont facultatifs — expand", () => {
  const fields = Object.keys(schema.tables.agentKnowledgeFiles.validator.fields)
  expect(fields).toEqual(expect.arrayContaining(["ocrPage", "ocrTotal"]))
})

test("leads.seenAt est facultatif — expand, les fiches déjà en base restent valides", async () => {
  expect(Object.keys(schema.tables.leads.validator.fields)).toContain("seenAt")
  const t = convexTest(schema, modules)
  const id = await t.run(async (ctx) =>
    ctx.db.insert("leads", {
      name: "Camille",
      email: "camille@example.com",
      status: "new",
      lastMessageAt: 1,
      messageCount: 1,
    }),
  )
  const doc = await t.run(async (ctx) => ctx.db.get(id))
  expect(doc?.seenAt).toBeUndefined()
})

test("leads.email est facultatif et by_ip existe — expand, fiche identifiée par l'IP", async () => {
  expect(schema.tables.leads.indexes.map((idx) => idx.indexDescriptor)).toEqual(
    expect.arrayContaining(["by_email", "by_ip"]),
  )
  const t = convexTest(schema, modules)
  const id = await t.run(async (ctx) =>
    ctx.db.insert("leads", {
      name: "Visiteur",
      status: "new",
      lastMessageAt: 1,
      messageCount: 0,
      ip: "203.0.113.42",
      source: "chat",
    }),
  )
  const doc = await t.run(async (ctx) => ctx.db.get(id))
  expect(doc?.email).toBeUndefined()
  expect(doc?.ip).toBe("203.0.113.42")
})

test("chatFiles existe avec les index par fil et par message", () => {
  expect(schema.tables.chatFiles).toBeDefined()
  const fields = Object.keys(schema.tables.chatFiles.validator.fields)
  expect(fields).toEqual(
    expect.arrayContaining(["threadId", "messageId", "storageId", "filename", "mime", "size"]),
  )
})

test("le schéma refuse un document profils portant un champ role", async () => {
  const t = convexTest(schema, modules)
  await expect(
    t.run(async (ctx) =>
      ctx.db.insert(
        "profiles",
        { authUserId: "user_2", displayName: "Rogue", role: "owner" } as never,
      ),
    ),
  ).rejects.toThrow()
})

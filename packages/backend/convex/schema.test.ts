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
})

test("les trois tables DataForSEO existent avec leurs index", () => {
  expect(schema.tables.seoRanks).toBeDefined()
  expect(schema.tables.seoSiteKeywords).toBeDefined()
  expect(schema.tables.seoSiteBacklinks).toBeDefined()
  const indexNames = schema.tables.seoRanks.indexes.map((idx) => idx.indexDescriptor)
  expect(indexNames).toEqual(expect.arrayContaining(["by_page", "by_post"]))
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

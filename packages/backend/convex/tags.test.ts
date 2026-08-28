import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import { api } from "./_generated/api"
import { MAX_TAG_NAME_LENGTH } from "./tags"
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

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor"
) {
  const email = `tags-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple tags"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

// ---------------------------------------------------------------------
// Unicité par slug, pas par nom
// ---------------------------------------------------------------------

test("deux noms qui se réduisent au même slug entrent en collision", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")

  await editor.identity.mutation(api.tags.create, { name: "Astro" })
  // C'est la propriété que ce lot doit tenir : sans elle, « Astro » et
  // « astro » deviennent deux tags distincts pointant deux URL
  // différentes qui listent les mêmes articles.
  await expect(
    editor.identity.mutation(api.tags.create, { name: "astro" }),
  ).rejects.toMatchObject({ data: { code: "SLUG_TAKEN" } })
  await expect(
    editor.identity.mutation(api.tags.create, { name: "  ASTRO  " }),
  ).rejects.toMatchObject({ data: { code: "SLUG_TAKEN" } })
})

test("les accents et la ponctuation ne créent pas de doublon", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")

  await editor.identity.mutation(api.tags.create, { name: "Référencement" })
  await expect(
    editor.identity.mutation(api.tags.create, { name: "referencement" }),
  ).rejects.toMatchObject({ data: { code: "SLUG_TAKEN" } })
})

test("create conserve le nom tel qu'il a été saisi, et dérive le slug", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")

  const id = await editor.identity.mutation(api.tags.create, { name: "No-Code & IA" })
  const row = await t.run((ctx) => ctx.db.get(id))
  // L'affichage garde la graphie humaine ; seule l'URL est normalisée.
  expect(row?.name).toBe("No-Code & IA")
  expect(row?.slug).toBe("no-code-ia")
})

// ---------------------------------------------------------------------
// Bornes
// ---------------------------------------------------------------------

test("create refuse un nom vide, ou fait uniquement de ponctuation", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")

  await expect(
    editor.identity.mutation(api.tags.create, { name: "   " }),
  ).rejects.toMatchObject({ data: { code: "INVALID_NAME" } })

  // « !!! » a un nom non vide mais un slug vide : stocké tel quel, il
  // entrerait en collision avec tous les autres slugs vides.
  await expect(
    editor.identity.mutation(api.tags.create, { name: "!!!" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_NAME" } })
})

test("create refuse un nom au-delà de la borne, et l'accepte à la borne", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")

  await expect(
    editor.identity.mutation(api.tags.create, { name: "x".repeat(MAX_TAG_NAME_LENGTH + 1) }),
  ).rejects.toMatchObject({ data: { code: "FIELD_TOO_LONG", field: "name" } })

  const id = await editor.identity.mutation(api.tags.create, {
    name: "x".repeat(MAX_TAG_NAME_LENGTH),
  })
  expect(id).toBeDefined()
})

// ---------------------------------------------------------------------
// rename
// ---------------------------------------------------------------------

test("rename change le nom et le slug, et refuse une collision", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")

  const astro = await editor.identity.mutation(api.tags.create, { name: "Astro" })
  await editor.identity.mutation(api.tags.create, { name: "Convex" })

  await editor.identity.mutation(api.tags.rename, { id: astro, name: "Astro 7" })
  const row = await t.run((ctx) => ctx.db.get(astro))
  expect(row?.slug).toBe("astro-7")

  await expect(
    editor.identity.mutation(api.tags.rename, { id: astro, name: "convex" }),
  ).rejects.toMatchObject({ data: { code: "SLUG_TAKEN" } })
})

test("rename vers sa propre graphie n'est pas une collision avec soi-même", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")

  const id = await editor.identity.mutation(api.tags.create, { name: "Astro" })
  // Corriger la casse d'un tag existant doit marcher : l'exclusion de
  // soi-même est le détail qu'on oublie et qui rend le renommage
  // impossible sans le supprimer d'abord.
  await editor.identity.mutation(api.tags.rename, { id, name: "ASTRO" })
  expect((await t.run((ctx) => ctx.db.get(id)))?.name).toBe("ASTRO")
})

// ---------------------------------------------------------------------
// Rôles et suppression
// ---------------------------------------------------------------------

test("un editor peut créer et renommer, mais pas supprimer", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const id = await editor.identity.mutation(api.tags.create, { name: "Ephemere" })

  await expect(
    editor.identity.mutation(api.tags.remove, { id }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
})

test("remove supprime un tag que rien ne porte", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.tags.create, { name: "Ephemere" })

  await owner.identity.mutation(api.tags.remove, { id })
  expect(await t.run((ctx) => ctx.db.get(id))).toBeNull()
})

test("list rend les tags par ordre alphabétique de nom", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  for (const name of ["Convex", "Astro", "Tailwind"]) {
    await owner.identity.mutation(api.tags.create, { name })
  }

  const rows = await owner.identity.query(api.tags.list, {})
  expect(rows.map((r) => r.name)).toEqual(["Astro", "Convex", "Tailwind"])
})

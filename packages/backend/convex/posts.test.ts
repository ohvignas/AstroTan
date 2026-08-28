import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import { api } from "./_generated/api"
import { MAX_EXCERPT_LENGTH, MAX_POST_BODY_LENGTH } from "./posts"
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
  const email = `posts-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple posts"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

// ---------------------------------------------------------------------
// Le corps est du Markdown, stocké verbatim
// ---------------------------------------------------------------------

test("create ouvre un brouillon au corps vide, et update l'enregistre tel quel", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Mon article",
    slug: "mon-article",
  })

  const fresh = await t.run((ctx) => ctx.db.get(id))
  expect(fresh?.status).toBe("draft")
  expect(fresh?.body).toBe("")
  expect(fresh?.tagIds).toEqual([])

  // Verbatim : un agent, ou un éditeur, écrit ce champ et le relit. Toute
  // normalisation ici réécrirait silencieusement son travail.
  const body = "# Titre\n\nUn paragraphe avec du *gras*.\n\n- un\n- deux\n"
  await owner.identity.mutation(api.posts.update, { id, body })
  expect((await t.run((ctx) => ctx.db.get(id)))?.body).toBe(body)
})

test("update refuse un corps au-delà de sa borne", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Trop long",
    slug: "trop-long",
  })

  await expect(
    owner.identity.mutation(api.posts.update, {
      id,
      body: "x".repeat(MAX_POST_BODY_LENGTH + 1),
    }),
  ).rejects.toMatchObject({ data: { code: "FIELD_TOO_LONG", field: "body" } })
})

test("update refuse un extrait au-delà de sa borne", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Extrait",
    slug: "extrait",
  })

  await expect(
    owner.identity.mutation(api.posts.update, {
      id,
      excerpt: "x".repeat(MAX_EXCERPT_LENGTH + 1),
    }),
  ).rejects.toMatchObject({ data: { code: "FIELD_TOO_LONG", field: "excerpt" } })
})

// ---------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------

test("create refuse un slug déjà pris par un autre article", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.posts.create, { title: "A", slug: "meme-slug" })

  await expect(
    owner.identity.mutation(api.posts.create, { title: "B", slug: "meme-slug" }),
  ).rejects.toMatchObject({ data: { code: "SLUG_ALREADY_EXISTS" } })
})

test("un article et une page peuvent porter le même slug", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.pages.create, { title: "Page", slug: "tarifs" })

  // Espaces de noms distincts : `/tarifs` et `/blog/tarifs`. Refuser ici
  // interdirait une combinaison parfaitement valide.
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Article",
    slug: "tarifs",
  })
  expect(id).toBeDefined()
})

// ---------------------------------------------------------------------
// Décision 2 du plan : `blog` est un slug de page réservé
// ---------------------------------------------------------------------

test("pages.create refuse le slug réservé blog", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  // `/blog` est une route Astro. Une page CMS portant ce slug serait
  // masquée par elle, sans erreur ni trace.
  await expect(
    owner.identity.mutation(api.pages.create, { title: "Blog", slug: "blog" }),
  ).rejects.toMatchObject({ data: { code: "SLUG_RESERVED" } })
})

test("pages.update refuse de renommer une page vers blog", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.pages.create, {
    title: "Autre",
    slug: "autre",
  })

  // Renommer après coup est le même défaut : la garde doit valoir aux
  // deux points d'écriture, pas seulement à la création.
  await expect(
    owner.identity.mutation(api.pages.update, { id, slug: "blog" }),
  ).rejects.toMatchObject({ data: { code: "SLUG_RESERVED" } })
})

// ---------------------------------------------------------------------
// Références : tags et couverture
// ---------------------------------------------------------------------

test("update refuse un tag qui n'existe pas", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Tags",
    slug: "tags-inconnus",
  })
  const ghost = await t.run(async (ctx) => {
    const tmp = await ctx.db.insert("tags", { name: "Tmp", slug: "tmp" })
    await ctx.db.delete(tmp)
    return tmp
  })

  await expect(
    owner.identity.mutation(api.posts.update, { id, tagIds: [ghost] }),
  ).rejects.toMatchObject({ data: { code: "UNKNOWN_TAG" } })
})

test("update accepte des tags existants et les enregistre dans l'ordre fourni", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Tags",
    slug: "tags-connus",
  })
  const astro = await owner.identity.mutation(api.tags.create, { name: "Astro" })
  const convex = await owner.identity.mutation(api.tags.create, { name: "Convex" })

  await owner.identity.mutation(api.posts.update, { id, tagIds: [convex, astro] })
  expect((await t.run((ctx) => ctx.db.get(id)))?.tagIds).toEqual([convex, astro])
})

test("update refuse deux fois le même tag", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Doublon",
    slug: "tag-doublon",
  })
  const astro = await owner.identity.mutation(api.tags.create, { name: "Astro" })

  // Un doublon rendrait l'article deux fois dans la liste d'un tag, et
  // afficherait deux fois la même étiquette.
  await expect(
    owner.identity.mutation(api.posts.update, { id, tagIds: [astro, astro] }),
  ).rejects.toMatchObject({ data: { code: "DUPLICATE_TAG" } })
})

test("update refuse une couverture dont le fichier n'existe pas", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Couverture",
    slug: "couverture",
  })
  const ghost = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["x"]))
    await ctx.storage.delete(storageId)
    return storageId
  })

  await expect(
    owner.identity.mutation(api.posts.update, { id, coverId: ghost }),
  ).rejects.toMatchObject({ data: { code: "UNKNOWN_MEDIA" } })
})

// ---------------------------------------------------------------------
// Suppression d'un tag encore porté
// ---------------------------------------------------------------------

test("tags.remove refuse un tag encore porté par un article", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const tagId = await owner.identity.mutation(api.tags.create, { name: "Porté" })
  const postId = await owner.identity.mutation(api.posts.create, {
    title: "Article",
    slug: "article-avec-tag",
  })
  await owner.identity.mutation(api.posts.update, { id: postId, tagIds: [tagId] })

  // Sans cette garde, `tagIds` garde un identifiant mort : l'étiquette
  // disparaît de l'article sans que rien ne le signale.
  await expect(
    owner.identity.mutation(api.tags.remove, { id: tagId }),
  ).rejects.toMatchObject({ data: { code: "TAG_IN_USE" } })
})

// ---------------------------------------------------------------------
// Autorisations
// ---------------------------------------------------------------------

test("un editor ne peut modifier que ses propres articles", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const foreign = await owner.identity.mutation(api.posts.create, {
    title: "À l'owner",
    slug: "a-l-owner",
  })

  const editor = await seedActor(t, "editor")
  await expect(
    editor.identity.mutation(api.posts.update, { id: foreign, title: "Volé" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })

  const own = await editor.identity.mutation(api.posts.create, {
    title: "Le mien",
    slug: "le-mien",
  })
  await editor.identity.mutation(api.posts.update, { id: own, title: "Le mien, édité" })
  expect((await t.run((ctx) => ctx.db.get(own)))?.title).toBe("Le mien, édité")
})

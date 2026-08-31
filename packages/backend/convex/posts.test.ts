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

test("update accepte coverId: null et retire la couverture", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Avec couverture",
    slug: "avec-couverture",
  })
  const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob(["x"])))
  await owner.identity.mutation(api.posts.update, { id, coverId: storageId })
  expect((await t.run((ctx) => ctx.db.get(id)))?.coverId).toBe(storageId)

  await owner.identity.mutation(api.posts.update, { id, coverId: null })
  expect((await t.run((ctx) => ctx.db.get(id)))?.coverId).toBeUndefined()
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

// ---------------------------------------------------------------------
// L'invariant du lot
// ---------------------------------------------------------------------

test("getPublishedPost ne sert jamais un brouillon, même avec le bon slug", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.posts.create, {
    title: "Brouillon",
    slug: "brouillon-confidentiel",
  })

  // Appelé sans identité — la posture exacte d'`apps/web`, qui n'a ni
  // session ni clé admin.
  expect(await t.query(api.posts.getPublishedPost, { slug: "brouillon-confidentiel" })).toBeNull()
})

test("listPublishedPosts n'expose aucun brouillon", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.posts.create, { title: "Brouillon", slug: "b1" })
  const publie = await owner.identity.mutation(api.posts.create, { title: "Publié", slug: "p1" })
  await t.run((ctx) => ctx.db.patch(publie, { status: "published", publishedAt: Date.now() }))

  const rows = await t.query(api.posts.listPublishedPosts, {})
  expect(rows.map((r) => r.slug)).toEqual(["p1"])
})

test("listPublishedPosts rend les articles du plus récent au plus ancien", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  for (const [slug, at] of [["vieux", 1000], ["recent", 3000], ["moyen", 2000]] as const) {
    const id = await owner.identity.mutation(api.posts.create, { title: slug, slug })
    await t.run((ctx) => ctx.db.patch(id, { status: "published", publishedAt: at }))
  }

  const rows = await t.query(api.posts.listPublishedPosts, {})
  expect(rows.map((r) => r.slug)).toEqual(["recent", "moyen", "vieux"])
})

test("previewPost refuse un jeton de type page visant le même slug", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.posts.create, { title: "Article", slug: "collision" })
  await owner.identity.mutation(api.pages.create, { title: "Page", slug: "collision" })

  // Le garde-fou central du lot : l'HMAC couvre le *type*, donc un jeton
  // frappé pour la page ne peut pas ouvrir l'article homonyme.
  const pageId = await t.run(async (ctx) =>
    (await ctx.db.query("pages").withIndex("by_slug", (q) => q.eq("slug", "collision")).unique())!._id,
  )
  const { token } = await owner.identity.mutation(api.pages.mintPreviewToken, { id: pageId })

  await expect(
    t.query(api.posts.previewPost, { slug: "collision", token }),
  ).rejects.toMatchObject({ data: { code: "INVALID_PREVIEW_TOKEN" } })
})

test("previewPost ouvre le brouillon avec son propre jeton, et refuse celui d'un autre article", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const cible = await owner.identity.mutation(api.posts.create, { title: "Cible", slug: "cible" })
  await owner.identity.mutation(api.posts.create, { title: "Autre", slug: "autre" })

  const { token, slug } = await owner.identity.mutation(api.posts.mintPostPreviewToken, {
    id: cible,
  })
  expect(slug).toBe("cible")

  const post = await t.query(api.posts.previewPost, { slug: "cible", token })
  expect(post?.status).toBe("draft")

  await expect(
    t.query(api.posts.previewPost, { slug: "autre", token }),
  ).rejects.toMatchObject({ data: { code: "INVALID_PREVIEW_TOKEN" } })
})

test("previewPost refuse un jeton expiré, altéré, ou absent", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, { title: "X", slug: "x" })
  const { token } = await owner.identity.mutation(api.posts.mintPostPreviewToken, { id })

  const last = token.at(-1)
  const altere = token.slice(0, -1) + (last === "0" ? "1" : "0")
  for (const bad of ["", "pas-un-jeton", altere]) {
    await expect(
      t.query(api.posts.previewPost, { slug: "x", token: bad }),
    ).rejects.toMatchObject({ data: { code: "INVALID_PREVIEW_TOKEN" } })
  }
})

// ---------------------------------------------------------------------
// Publication et invalidation
// ---------------------------------------------------------------------

async function outboxRows(t: TestConvex<typeof schema>) {
  return t.run((ctx) => ctx.db.query("revalidationOutbox").collect())
}

test("publishPost est réservé à owner/admin", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const id = await editor.identity.mutation(api.posts.create, {
    title: "À moi",
    slug: "a-moi",
  })

  // Un editor peut écrire son article, pas décider qu'il part en ligne.
  await expect(
    editor.identity.mutation(api.posts.publishPost, { id }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
})

test("publishPost écrit la ligne d'outbox dans la même transaction que le statut", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Publié",
    slug: "publie",
  })

  await owner.identity.mutation(api.posts.publishPost, { id })

  const post = await t.run((ctx) => ctx.db.get(id))
  expect(post?.status).toBe("published")
  expect(post?.publishedAt).toBeDefined()

  const rows = await outboxRows(t)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.tags).toEqual(["posts", "post:publie"])
  expect(rows[0]?.kind).toBe("post")
  expect(rows[0]?.postId).toBe(id)
  // Jamais de `pageId` : c'est ce qui garde le repli de
  // `pages.publicationStatus` sur un ensemble figé.
  expect(rows[0]?.pageId).toBeUndefined()
})

test("republier écrit une nouvelle ligne, même si le statut ne change pas", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, { title: "R", slug: "r" })

  await owner.identity.mutation(api.posts.publishPost, { id })
  await owner.identity.mutation(api.posts.publishPost, { id })

  // Chaque publication signale que ce qui est en ligne peut être périmé,
  // que `status` ait bougé ou non.
  expect(await outboxRows(t)).toHaveLength(2)
})

test("unpublishPost repasse en brouillon et invalide aussi", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, { title: "U", slug: "u" })
  await owner.identity.mutation(api.posts.publishPost, { id })

  await owner.identity.mutation(api.posts.unpublishPost, { id })

  expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("draft")
  // Sans cette invalidation, l'article retiré resterait servi depuis le
  // cache jusqu'à expiration — le pire moment pour attendre.
  const rows = await outboxRows(t)
  expect(rows).toHaveLength(2)
  expect(rows[1]?.tags).toEqual(["posts", "post:u"])

  expect(await t.query(api.posts.getPublishedPost, { slug: "u" })).toBeNull()
})

// --- Relecture finale, correctif 2 : trace d'audit ------------------------
//
// `pages.publishPage`/`pages.unpublish` sont journalisées (voir
// `pages.ts`) ; `publishPost`/`unpublishPost` ne l'étaient pas, alors que
// le raisonnement — un slug qui se met à répondre, ou cesse de répondre,
// au public — est identique côté articles.

test("publishPost laisse une trace nommant l'acteur et le slug", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, { title: "Trace", slug: "trace" })

  await owner.identity.mutation(api.posts.publishPost, { id })

  const lignes = await t.run((ctx) => ctx.db.query("auditLog").collect())
  expect(lignes).toHaveLength(1)
  expect(lignes[0]?.action).toBe("post.publish")
  expect(lignes[0]?.acteurId).toBe(owner.id)
  expect(lignes[0]?.cible).toBe("trace")
})

test("unpublishPost laisse une trace nommant l'acteur et le slug", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Trace 2",
    slug: "trace-2",
  })
  await owner.identity.mutation(api.posts.publishPost, { id })

  await owner.identity.mutation(api.posts.unpublishPost, { id })

  const lignes = await t.run((ctx) => ctx.db.query("auditLog").collect())
  const derniere = lignes.at(-1)
  expect(derniere?.action).toBe("post.unpublish")
  expect(derniere?.acteurId).toBe(owner.id)
  expect(derniere?.cible).toBe("trace-2")
})

// Même raisonnement que `pages.unpublish` (`pages.ts:594`) : une ligne
// « a dépublié » sur un article déjà en brouillon rendrait le journal
// faux, ce qui est pire qu'incomplet.
test("dépublier un article déjà en brouillon n'invente pas de trace", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Jamais publié",
    slug: "jamais-publie",
  })

  await owner.identity.mutation(api.posts.unpublishPost, { id })

  expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(0)
})

test("publicationStatus rend l'état réel de la propagation", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, { title: "S", slug: "s" })

  expect(await owner.identity.query(api.posts.publicationStatus, { id })).toEqual({
    state: "draft",
  })

  await owner.identity.mutation(api.posts.publishPost, { id })
  expect(
    (await owner.identity.query(api.posts.publicationStatus, { id }))?.state,
  ).toBe("propagating")

  const rowId = (await outboxRows(t))[0]!._id
  await t.run((ctx) => ctx.db.patch(rowId, { status: "done" }))
  expect(
    (await owner.identity.query(api.posts.publicationStatus, { id }))?.state,
  ).toBe("published")

  await t.run((ctx) => ctx.db.patch(rowId, { status: "failed", lastError: "boom" }))
  const failed = await owner.identity.query(api.posts.publicationStatus, { id })
  expect(failed?.state).toBe("failed")
})

test("publier un article ne perturbe pas le statut de propagation d'une page", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const pageId = await owner.identity.mutation(api.pages.create, {
    title: "Page",
    slug: "une-page",
  })
  await owner.identity.mutation(api.pages.publishPage, { id: pageId })
  const pageRow = (await outboxRows(t))[0]!._id
  await t.run((ctx) => ctx.db.patch(pageRow, { status: "done" }))

  const postId = await owner.identity.mutation(api.posts.create, {
    title: "Article",
    slug: "un-article",
  })
  await owner.identity.mutation(api.posts.publishPost, { id: postId })

  // La ligne de l'article n'a pas de `pageId` : sans le discriminant
  // `kind`, elle tomberait dans le balayage de repli de la page et
  // ferait basculer son badge en « inconnu ».
  expect(
    (await owner.identity.query(api.pages.publicationStatus, { id: pageId }))?.state,
  ).toBe("published")
})

// ---------------------------------------------------------------------
// Les trois trous trouvés à la revue de la Task 7
// ---------------------------------------------------------------------

test("modifier un article publié invalide son cache", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, { title: "M", slug: "m" })
  await owner.identity.mutation(api.posts.publishPost, { id })
  const apresPublication = (await outboxRows(t)).length

  await owner.identity.mutation(api.posts.update, { id, title: "M, corrigé" })

  // Sans ça, la réponse cachée reste périmée jusqu'à `maxAge` pendant que
  // le badge du tableau de bord affiche « Publié ».
  const rows = await outboxRows(t)
  expect(rows).toHaveLength(apresPublication + 1)
  expect(rows.at(-1)?.tags).toEqual(["posts", "post:m"])
})

test("renommer le slug d'un article publié invalide l'ancien ET le nouveau", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, { title: "R", slug: "avant" })
  await owner.identity.mutation(api.posts.publishPost, { id })

  await owner.identity.mutation(api.posts.update, { id, slug: "apres" })

  // N'invalider que le nouveau laisserait l'ancienne URL servie depuis le
  // cache, avec plus rien pour l'invalider un jour.
  expect((await outboxRows(t)).at(-1)?.tags).toEqual([
    "posts",
    "post:avant",
    "post:apres",
  ])
})

test("supprimer un article publié invalide son cache", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, { title: "S", slug: "s-del" })
  await owner.identity.mutation(api.posts.publishPost, { id })

  await owner.identity.mutation(api.posts.remove, { id })

  // Un article supprimé mais toujours servi depuis le cache reste lisible
  // à son URL alors qu'il n'existe plus.
  expect((await outboxRows(t)).at(-1)?.tags).toEqual(["posts", "post:s-del"])
})

// Relecture finale, correctif 2 : ni `pages.remove` ni `posts.remove` ne
// laissaient de trace, alors que supprimer est strictement plus
// destructeur que dépublier — déjà journalisé juste au-dessus.
test("supprimer un article laisse une trace nommant l'acteur et le slug", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, {
    title: "À journaliser",
    slug: "a-journaliser",
  })

  await owner.identity.mutation(api.posts.remove, { id })

  const lignes = await t.run((ctx) => ctx.db.query("auditLog").collect())
  expect(lignes).toHaveLength(1)
  expect(lignes[0]?.action).toBe("post.remove")
  expect(lignes[0]?.acteurId).toBe(owner.id)
  expect(lignes[0]?.cible).toBe("a-journaliser")
})

test("un editor ne peut plus modifier ni supprimer son article une fois publié", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const id = await editor.identity.mutation(api.posts.create, {
    title: "Le mien",
    slug: "le-mien-publie",
  })

  // Il l'édite librement tant qu'il est brouillon.
  await editor.identity.mutation(api.posts.update, { id, title: "Le mien, v2" })

  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.posts.publishPost, { id })

  // Publier ne dépend pas de la propriété : une fois qu'un owner a publié
  // l'article d'un editor, l'accès « je modifie mes documents » de cet
  // editor atteindrait la ligne servie publiquement. C'est le contournement
  // que les pages avaient fermé et que les articles rouvraient.
  await expect(
    editor.identity.mutation(api.posts.update, { id, title: "Détourné" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
  await expect(
    editor.identity.mutation(api.posts.remove, { id }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })

  // L'owner, lui, passe outre — c'est la règle, pas une exception.
  await owner.identity.mutation(api.posts.update, { id, title: "Corrigé par l'owner" })
})

import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { getFunctionName } from "convex/server"
import { verifyPreviewToken } from "./lib/previewToken"
import { MAX_GEO_SUMMARY_LENGTH } from "./content"
import { ORIGIN, identityFor, makeTestConvex, seedUser, signIn } from "../testing/betterAuthFixture"

// Task 8 — the page editor screen's own mutations/queries: `create`,
// `update`, `remove`, `unpublish`, `mintPreviewToken`, `list`, `get`,
// `publicationStatus`. `lib/authz.test.ts`'s registry matrix already
// proves the role/ownership boundary for a *same-owner* fixture on every
// entry — what it structurally cannot express (one `invoke` per entry,
// applied identically across all three roles) is "an editor is refused on
// someone *else's* document." That cross-ownership case, plus everything
// else specific to what each of these functions actually writes/returns,
// is this file's job.

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

async function seedActor(t: TestConvex<typeof schema>, role: "owner" | "admin" | "editor") {
  const email = `crud-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple 1"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  const identity = await identityFor(t, user.id)
  return { identity, id: user.id }
}

// ---------------------------------------------------------------------
// create
// ---------------------------------------------------------------------

test("create insère un brouillon appartenant à l'appelant", async () => {
  const t = makeTestConvex()
  const actor = await seedActor(t, "editor")
  const id = await actor.identity.mutation(api.pages.create, {
    title: "Ma page",
    slug: "ma-page",
  })
  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.title).toBe("Ma page")
  expect(page?.slug).toBe("ma-page")
  expect(page?.status).toBe("draft")
  expect(page?.createdBy).toBe(actor.id)
  expect(page?.updatedBy).toBe(actor.id)
})

test("create normalise le slug (espaces, slashes de tête/fin)", async () => {
  const t = makeTestConvex()
  const actor = await seedActor(t, "owner")
  const id = await actor.identity.mutation(api.pages.create, {
    title: "  Titre avec espaces  ",
    slug: "  /a-propos/  ",
  })
  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.title).toBe("Titre avec espaces")
  expect(page?.slug).toBe("a-propos")
})

test("create refuse un slug déjà utilisé", async () => {
  const t = makeTestConvex()
  const actor = await seedActor(t, "owner")
  await actor.identity.mutation(api.pages.create, { title: "Une page", slug: "doublon" })
  await expect(
    actor.identity.mutation(api.pages.create, { title: "Une autre page", slug: "doublon" }),
  ).rejects.toMatchObject({ data: { code: "SLUG_ALREADY_EXISTS" } })
})

test("create refuse un titre vide (après trim)", async () => {
  const t = makeTestConvex()
  const actor = await seedActor(t, "owner")
  await expect(
    actor.identity.mutation(api.pages.create, { title: "   ", slug: "vide" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_TITLE" } })
})

test("create refuse un slug vide (après normalisation)", async () => {
  const t = makeTestConvex()
  const actor = await seedActor(t, "owner")
  await expect(
    actor.identity.mutation(api.pages.create, { title: "Titre", slug: "///" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SLUG" } })
})

test("create refuse un titre plus long que MAX_PAGE_TITLE_LENGTH", async () => {
  const t = makeTestConvex()
  const actor = await seedActor(t, "owner")
  await expect(
    actor.identity.mutation(api.pages.create, { title: "x".repeat(300), slug: "trop-long" }),
  ).rejects.toMatchObject({ data: { code: "FIELD_TOO_LONG", field: "title" } })
})

// ---------------------------------------------------------------------
// update — the ownership boundary the registry matrix cannot express
// ---------------------------------------------------------------------

async function insertOwnedPage(
  t: TestConvex<typeof schema>,
  overrides: { slug: string; createdBy: string; status?: "draft" | "published" },
) {
  return t.run((ctx) =>
    ctx.db.insert("pages", {
      slug: overrides.slug,
      title: "Titre initial",
      status: overrides.status ?? "draft",
      createdBy: overrides.createdBy,
      updatedBy: overrides.createdBy,
    }),
  )
}

test("un admin modifie la page de quelqu'un d'autre", async () => {
  const t = makeTestConvex()
  const editorActor = await seedActor(t, "editor")
  const admin = await seedActor(t, "admin")
  const id = await insertOwnedPage(t, { slug: "page-editor", createdBy: editorActor.id })

  await admin.identity.mutation(api.pages.update, { id, title: "Modifié par l'admin" })
  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.title).toBe("Modifié par l'admin")
  expect(page?.updatedBy).toBe(admin.id)
})

test("un editor modifie sa propre page", async () => {
  const t = makeTestConvex()
  const editorActor = await seedActor(t, "editor")
  const id = await insertOwnedPage(t, { slug: "propre-page", createdBy: editorActor.id })

  await editorActor.identity.mutation(api.pages.update, { id, title: "Modifié par moi-même" })
  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.title).toBe("Modifié par moi-même")
})

test("un editor ne peut PAS modifier la page de quelqu'un d'autre — refusé côté serveur", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const editorActor = await seedActor(t, "editor")
  const id = await insertOwnedPage(t, { slug: "page-du-owner", createdBy: owner.id })

  await expect(
    editorActor.identity.mutation(api.pages.update, { id, title: "Piraté" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.title).toBe("Titre initial")
})

// H1 (whole-lot review): `publishPage`'s owner/admin-only gate does not
// survive composition with `update`'s ownership-only gate. Once any
// owner/admin has published a page whose `createdBy` is a given editor,
// that editor's own write access (legitimate on a draft) lets them rewrite
// the *live*, publicly served row — `getPublishedPage` has no separate
// "frozen at publish time" copy to fall back on. `update` must refuse an
// editor outright once the page is published, regardless of ownership.
test("un editor ne peut PAS modifier sa propre page une fois publiée", async () => {
  const t = makeTestConvex()
  const editorActor = await seedActor(t, "editor")
  const id = await insertOwnedPage(t, {
    slug: "page-publiee-editor",
    createdBy: editorActor.id,
    status: "published",
  })

  await expect(
    editorActor.identity.mutation(api.pages.update, { id, title: "Piraté depuis mon propre brouillon publié" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.title).toBe("Titre initial")
})

// The other direction: the same editor, the same page, still a draft —
// refused only once it's live, not unconditionally.
test("le même editor modifie encore sa propre page tant qu'elle est en brouillon", async () => {
  const t = makeTestConvex()
  const editorActor = await seedActor(t, "editor")
  const id = await insertOwnedPage(t, {
    slug: "page-brouillon-editor",
    createdBy: editorActor.id,
    status: "draft",
  })

  await expect(
    editorActor.identity.mutation(api.pages.update, { id, title: "Modifié avant publication" }),
  ).resolves.not.toThrow()
  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.title).toBe("Modifié avant publication")
})

test("un owner peut toujours modifier une page publiée (le refus ne vise que l'editor)", async () => {
  const t = makeTestConvex()
  const editorActor = await seedActor(t, "editor")
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, {
    slug: "page-publiee-owner-edite",
    createdBy: editorActor.id,
    status: "published",
  })

  await expect(
    owner.identity.mutation(api.pages.update, { id, title: "Modifié par le owner" }),
  ).resolves.not.toThrow()
})

// M3 (whole-lot review): `update` was the only page mutation with no
// `insertOutboxRow` — `publishPage`, `remove`, and `unpublish` all have
// one. Saving an edit to an already-*published* page therefore left the
// cached response stale for up to `maxAge`/`swr` while the admin badge
// still read "Publiée". `update` must invalidate the page's own tag
// whenever it patches a page that is currently published.
test("modifier une page publiée insère une ligne d'outbox et programme drain", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, {
    slug: "page-live-a-editer",
    createdBy: owner.id,
    status: "published",
  })

  await owner.identity.mutation(api.pages.update, { id, title: "Titre édité en live" })

  const rows = await t.run((ctx) => ctx.db.query("revalidationOutbox").collect())
  expect(rows).toHaveLength(1)
  expect(rows[0]?.tags).toEqual(["pages", "page:page-live-a-editer"])
  expect(rows[0]?.pageId).toBe(id)

  const expectedName = getFunctionName(internal.revalidate.drain)
  const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
  expect(scheduled.some((job) => job.name === expectedName)).toBe(true)
})

test("modifier un brouillon n'insère aucune ligne d'outbox", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "brouillon-a-editer", createdBy: owner.id })

  await owner.identity.mutation(api.pages.update, { id, title: "Titre édité en brouillon" })

  const rows = await t.run((ctx) => ctx.db.query("revalidationOutbox").collect())
  expect(rows).toHaveLength(0)
})

// Renaming the slug of a live page must invalidate *both* the old and the
// new tag: the cache under `page:<old-slug>` would otherwise serve a page
// that should now 404 at that URL forever — nothing else would ever
// invalidate it, since every other mutation only ever tags the page's
// *current* slug.
test("renommer le slug d'une page publiée invalide l'ancien ET le nouveau slug", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, {
    slug: "ancien-slug",
    createdBy: owner.id,
    status: "published",
  })

  await owner.identity.mutation(api.pages.update, { id, slug: "nouveau-slug" })

  const rows = await t.run((ctx) => ctx.db.query("revalidationOutbox").collect())
  expect(rows).toHaveLength(1)
  expect(rows[0]?.tags).toEqual(["pages", "page:ancien-slug", "page:nouveau-slug"])
})

test("update refuse un id inexistant", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "temp", createdBy: owner.id })
  await t.run((ctx) => ctx.db.delete(id))
  await expect(
    owner.identity.mutation(api.pages.update, { id, title: "x" }),
  ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } })
})



test("update enregistre les champs GEO et les borne", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "geo", createdBy: owner.id })

  await owner.identity.mutation(api.pages.update, {
    id,
    geo: {
      summary: "Ce que fait la page, en une phrase.",
      faq: [{ question: "Combien ?", answer: "Gratuit." }],
      entities: ["AstroTan"],
      noai: true,
    },
  })
  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.geo?.summary).toBe("Ce que fait la page, en une phrase.")
  expect(page?.geo?.noai).toBe(true)

  await expect(
    owner.identity.mutation(api.pages.update, {
      id,
      geo: { summary: "x".repeat(MAX_GEO_SUMMARY_LENGTH + 1) },
    }),
  ).rejects.toMatchObject({ data: { code: "FIELD_TOO_LONG", field: "geo.summary" } })
})

test("update refuse de changer le slug vers un slug déjà pris par une autre page", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await insertOwnedPage(t, { slug: "slug-pris", createdBy: owner.id })
  const id = await insertOwnedPage(t, { slug: "slug-libre", createdBy: owner.id })
  await expect(
    owner.identity.mutation(api.pages.update, { id, slug: "slug-pris" }),
  ).rejects.toMatchObject({ data: { code: "SLUG_ALREADY_EXISTS" } })
})

test("update autorise de renvoyer le même slug sans se bloquer soi-même", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "reste-le-meme", createdBy: owner.id })
  await expect(
    owner.identity.mutation(api.pages.update, { id, slug: "reste-le-meme" }),
  ).resolves.not.toThrow()
})

// ---------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------

test("un editor supprime sa propre page", async () => {
  const t = makeTestConvex()
  const editorActor = await seedActor(t, "editor")
  const id = await insertOwnedPage(t, { slug: "a-supprimer", createdBy: editorActor.id })
  await editorActor.identity.mutation(api.pages.remove, { id })
  expect(await t.run((ctx) => ctx.db.get(id))).toBeNull()
})

test("un editor ne peut PAS supprimer la page de quelqu'un d'autre", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const editorActor = await seedActor(t, "editor")
  const id = await insertOwnedPage(t, { slug: "page-protegee", createdBy: owner.id })
  await expect(editorActor.identity.mutation(api.pages.remove, { id })).rejects.toMatchObject({
    data: { code: "FORBIDDEN" },
  })
  expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull()
})

// Closing-fixes review: the same H1 gap `update` had — `requireOwnDocument`
// alone lets an editor unilaterally turn a live, publicly served URL into a
// 404 by deleting their own *published* page. An editor cannot inject
// content that way (unlike `update`), but "an editor does not change what
// the public site serves once it is published" applies just as much to
// deleting the page out from under it. Only `editor` is refused here —
// owner/admin already bypass `requireOwnDocument` above this check and are
// unaffected by it, exactly like `update`'s own H1 guard.
test("un editor ne peut PAS supprimer sa propre page une fois publiée", async () => {
  const t = makeTestConvex()
  const editorActor = await seedActor(t, "editor")
  const id = await insertOwnedPage(t, {
    slug: "page-publiee-editor-suppression",
    createdBy: editorActor.id,
    status: "published",
  })
  await expect(
    editorActor.identity.mutation(api.pages.remove, { id }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
  expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull()
})

// An owner is never subject to this check — the refusal is `editor`-only,
// same as `update`'s own equivalent test.
test("un owner peut toujours supprimer une page publiée (le refus ne vise que l'editor)", async () => {
  const t = makeTestConvex()
  const editorActor = await seedActor(t, "editor")
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, {
    slug: "page-publiee-owner-supprime",
    createdBy: editorActor.id,
    status: "published",
  })
  await expect(owner.identity.mutation(api.pages.remove, { id })).resolves.not.toThrow()
  expect(await t.run((ctx) => ctx.db.get(id))).toBeNull()
})

test("supprimer une page publiée insère une ligne d'outbox et programme drain", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, {
    slug: "publiee-a-supprimer",
    createdBy: owner.id,
    status: "published",
  })
  await owner.identity.mutation(api.pages.remove, { id })

  const rows = await t.run((ctx) => ctx.db.query("revalidationOutbox").collect())
  expect(rows).toHaveLength(1)
  expect(rows[0]?.tags).toEqual(["pages", "page:publiee-a-supprimer"])

  const expectedName = getFunctionName(internal.revalidate.drain)
  const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
  expect(scheduled.some((job) => job.name === expectedName)).toBe(true)
})

test("supprimer un brouillon n'insère aucune ligne d'outbox", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "brouillon-a-supprimer", createdBy: owner.id })
  await owner.identity.mutation(api.pages.remove, { id })
  const rows = await t.run((ctx) => ctx.db.query("revalidationOutbox").collect())
  expect(rows).toHaveLength(0)
})

// Relecture finale, correctif 2 : `remove` ne laissait aucune trace,
// alors que `publishPage`/`unpublish` (couverts par `auditLog.test.ts`)
// en laissent une pour des gestes moins destructeurs — supprimer une page
// n'était donc pas reconstituable après coup.
test("supprimer une page laisse une trace nommant l'acteur et le slug", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "page-a-journaliser", createdBy: owner.id })

  await owner.identity.mutation(api.pages.remove, { id })

  const lignes = await t.run((ctx) => ctx.db.query("auditLog").collect())
  expect(lignes).toHaveLength(1)
  expect(lignes[0]?.action).toBe("page.remove")
  expect(lignes[0]?.acteurId).toBe(owner.id)
  expect(lignes[0]?.cible).toBe("page-a-journaliser")
})

// ---------------------------------------------------------------------
// unpublish
// ---------------------------------------------------------------------

test("unpublish repasse une page publiée en brouillon et insère une ligne d'outbox", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, {
    slug: "a-depublier",
    createdBy: owner.id,
    status: "published",
  })
  await owner.identity.mutation(api.pages.unpublish, { id })

  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.status).toBe("draft")
  const rows = await t.run((ctx) => ctx.db.query("revalidationOutbox").collect())
  expect(rows).toHaveLength(1)
  expect(rows[0]?.tags).toEqual(["pages", "page:a-depublier"])
})

test("unpublish sur un brouillon est un no-op — aucune ligne d'outbox", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "deja-brouillon", createdBy: owner.id })
  await owner.identity.mutation(api.pages.unpublish, { id })
  const rows = await t.run((ctx) => ctx.db.query("revalidationOutbox").collect())
  expect(rows).toHaveLength(0)
})

// ---------------------------------------------------------------------
// mintPreviewToken
// ---------------------------------------------------------------------

test("mintPreviewToken signe le slug de la page, pas son id", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "a-previsualiser", createdBy: owner.id })
  const { token, slug } = await owner.identity.mutation(api.pages.mintPreviewToken, { id })

  expect(slug).toBe("a-previsualiser")
  expect(await verifyPreviewToken({ type: "page", id: slug, token })).toBe(true)
  // L'id ne vérifie plus rien : c'est ce qui permet à l'aperçu de s'ouvrir
  // à la vraie URL de la page plutôt qu'à une route parallèle.
  expect(await verifyPreviewToken({ type: "page", id, token })).toBe(false)
})

test("un jeton d'aperçu n'ouvre pas une autre page", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const cible = await insertOwnedPage(t, { slug: "cible", createdBy: owner.id })
  await insertOwnedPage(t, { slug: "autre", createdBy: owner.id })
  const { token } = await owner.identity.mutation(api.pages.mintPreviewToken, { id: cible })

  await expect(
    t.query(api.pages.previewPage, { slug: "autre", token }),
  ).rejects.toMatchObject({ data: { code: "INVALID_PREVIEW_TOKEN" } })

  const page = await t.query(api.pages.previewPage, { slug: "cible", token })
  expect(page?.slug).toBe("cible")
})

test("mintPreviewToken refuse un id inexistant", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "temp-preview", createdBy: owner.id })
  await t.run((ctx) => ctx.db.delete(id))
  await expect(owner.identity.mutation(api.pages.mintPreviewToken, { id })).rejects.toMatchObject({
    data: { code: "NOT_FOUND" },
  })
})

// Design spec §5's role table: "editor: ... lecture des autres" — reading
// is open, only writing is ownership-gated. Minting a preview link is a
// read-shaped action (it reveals nothing `get` wouldn't already), so an
// editor may mint one for a page they don't own — this locks that
// deliberate choice in as a test, not just a comment.
test("un editor peut prévisualiser la page de quelqu'un d'autre (lecture ouverte)", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const editorActor = await seedActor(t, "editor")
  const id = await insertOwnedPage(t, { slug: "page-a-lire", createdBy: owner.id })
  await expect(
    editorActor.identity.mutation(api.pages.mintPreviewToken, { id }),
  ).resolves.toMatchObject({ token: expect.any(String) })
})

// ---------------------------------------------------------------------
// list / get — read access is open to all three roles
// ---------------------------------------------------------------------

test("list renvoie toutes les pages à un editor, y compris celles des autres", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const editorActor = await seedActor(t, "editor")
  await insertOwnedPage(t, { slug: "page-owner", createdBy: owner.id })
  await insertOwnedPage(t, { slug: "page-editor", createdBy: editorActor.id })

  const pages = await editorActor.identity.query(api.pages.list, {})
  expect(pages.map((p) => p.slug).sort()).toEqual(["page-editor", "page-owner"])
})

test("get renvoie la page de quelqu'un d'autre à un editor (lecture ouverte)", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const editorActor = await seedActor(t, "editor")
  const id = await insertOwnedPage(t, { slug: "page-owner-lue", createdBy: owner.id })

  const page = await editorActor.identity.query(api.pages.get, { id })
  expect(page?.slug).toBe("page-owner-lue")
})

test("get renvoie null pour un id inexistant", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "temp-get", createdBy: owner.id })
  await t.run((ctx) => ctx.db.delete(id))
  expect(await owner.identity.query(api.pages.get, { id })).toBeNull()
})

// ---------------------------------------------------------------------
// publicationStatus — this task's own "reason the outbox exists"
// ---------------------------------------------------------------------

test("publicationStatus renvoie draft pour une page non publiée", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "statut-brouillon", createdBy: owner.id })
  const status = await owner.identity.query(api.pages.publicationStatus, { id })
  expect(status).toEqual({ state: "draft" })
})

test("publicationStatus renvoie propagating tant que la ligne d'outbox est pending", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, {
    slug: "statut-en-cours",
    createdBy: owner.id,
    status: "published",
  })
  await t.run((ctx) =>
    ctx.db.insert("revalidationOutbox", {
      tags: ["pages", "page:statut-en-cours"],
      pageId: id,
      status: "pending",
      attempts: 1,
      nextAttemptAt: Date.now() + 5_000,
      createdAt: Date.now(),
    }),
  )
  const status = await owner.identity.query(api.pages.publicationStatus, { id })
  expect(status).toEqual({ state: "propagating", attempts: 1 })
})

test("publicationStatus renvoie published quand la ligne la plus récente est done", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, {
    slug: "statut-publie",
    createdBy: owner.id,
    status: "published",
  })
  await t.run((ctx) =>
    ctx.db.insert("revalidationOutbox", {
      tags: ["pages", "page:statut-publie"],
      pageId: id,
      status: "done",
      attempts: 0,
      nextAttemptAt: Date.now(),
      createdAt: Date.now(),
    }),
  )
  const status = await owner.identity.query(api.pages.publicationStatus, { id })
  expect(status?.state).toBe("published")
})

test("publicationStatus renvoie failed avec lastError quand la ligne la plus récente a échoué", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, {
    slug: "statut-echec",
    createdBy: owner.id,
    status: "published",
  })
  await t.run((ctx) =>
    ctx.db.insert("revalidationOutbox", {
      tags: ["pages", "page:statut-echec"],
      pageId: id,
      status: "failed",
      attempts: 6,
      nextAttemptAt: Date.now(),
      lastError: "HTTP 500",
      createdAt: Date.now(),
    }),
  )
  const status = await owner.identity.query(api.pages.publicationStatus, { id })
  expect(status).toEqual({ state: "failed", lastError: "HTTP 500", attempts: 6 })
})

// The "most recent by createdAt wins" claim itself: an older `failed` row
// must not shadow a newer successful republish.
test("publicationStatus retient la ligne la plus récente, pas la première trouvée", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, {
    slug: "statut-republication",
    createdBy: owner.id,
    status: "published",
  })
  const now = Date.now()
  await t.run((ctx) =>
    ctx.db.insert("revalidationOutbox", {
      tags: ["pages", "page:statut-republication"],
      pageId: id,
      status: "failed",
      attempts: 6,
      nextAttemptAt: now,
      lastError: "ancien échec",
      createdAt: now - 10_000,
    }),
  )
  await t.run((ctx) =>
    ctx.db.insert("revalidationOutbox", {
      tags: ["pages", "page:statut-republication"],
      pageId: id,
      status: "done",
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
    }),
  )
  const status = await owner.identity.query(api.pages.publicationStatus, { id })
  expect(status?.state).toBe("published")
})

// Closing-fixes review: `by_page_created_at` is an index on `["pageId",
// "createdAt"]` — a row written before `pageId` existed on this table (or
// any future row some other caller inserts without it) is structurally
// invisible to `q.eq("pageId", args.id)`, no matter how recent it is or
// what it actually recorded. Before this fix, `publicationStatus` treated
// "the index found nothing" as "settled, report published" — the exact
// `!x -> allow` shape this whole review has flagged everywhere else: a
// page whose true last propagation attempt failed would show a green
// "Publiée" badge, because the row recording that failure isn't
// indexable by pageId at all. `state: "unknown"` is what an honest badge
// renders instead of guessing.
test("publicationStatus refuse de dire 'published' quand la seule ligne pertinente n'est pas indexable par pageId", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, {
    slug: "statut-non-indexable",
    createdBy: owner.id,
    status: "published",
  })
  // Mirrors a pre-migration row: no `pageId` field at all, only the tag
  // ties it back to this page. The last real attempt actually failed.
  await t.run((ctx) =>
    ctx.db.insert("revalidationOutbox", {
      tags: ["pages", "page:statut-non-indexable"],
      status: "failed",
      attempts: 6,
      nextAttemptAt: Date.now(),
      lastError: "HTTP 500 (ligne pré-migration)",
      createdAt: Date.now(),
    }),
  )
  const status = await owner.identity.query(api.pages.publicationStatus, { id })
  expect(status).toEqual({ state: "unknown" })
})

// A legacy un-indexable row for a *different* page's tag must never leak
// into this page's answer — only tag-matching rows count.
test("publicationStatus ignore les lignes non indexables d'une autre page", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, {
    slug: "statut-non-indexable-autre-page",
    createdBy: owner.id,
    status: "published",
  })
  await t.run((ctx) =>
    ctx.db.insert("revalidationOutbox", {
      tags: ["pages", "page:une-toute-autre-page"],
      status: "failed",
      attempts: 6,
      nextAttemptAt: Date.now(),
      lastError: "sans rapport",
      createdAt: Date.now(),
    }),
  )
  const status = await owner.identity.query(api.pages.publicationStatus, { id })
  expect(status).toEqual({ state: "published", publishedAt: undefined })
})

// A genuinely settled page (published outside `publishPage`, e.g. a
// fixture) with zero outbox rows at all — indexable or not — must still
// report `published`, not `unknown`: "no rows anywhere for this page" is
// exactly the narrow case the original comment already covered correctly.
test("publicationStatus renvoie published (pas unknown) pour une page publiée sans aucune ligne d'outbox", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, {
    slug: "statut-sans-outbox",
    createdBy: owner.id,
    status: "published",
  })
  const status = await owner.identity.query(api.pages.publicationStatus, { id })
  expect(status?.state).toBe("published")
})

test("update refuse une URL canonique à schéma exécutable", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "canonique", createdBy: owner.id })

  // Ce champ va dans `<link rel="canonical" href>` sans passer par
  // l'assainisseur, qui ne voit que le corps rendu.
  for (const mauvais of ["javascript:alert(1)", "//evil.example", "/\\evil.example"]) {
    await expect(
      owner.identity.mutation(api.pages.update, {
        id,
        seo: { canonicalUrl: mauvais },
      }),
    ).rejects.toMatchObject({ data: { code: "UNSAFE_HREF", field: "seo.canonicalUrl" } })
  }

  await owner.identity.mutation(api.pages.update, {
    id,
    seo: { canonicalUrl: "https://exemple.fr/canonique" },
  })
  expect((await t.run((ctx) => ctx.db.get(id)))?.seo?.canonicalUrl).toBe(
    "https://exemple.fr/canonique",
  )
})

test("la page d'accueil n'est pas signalée « sans fichier »", async () => {
  const t = makeTestConvex()
  const { identity: owner } = await seedActor(t, "owner")

  await owner.mutation(api.pages.create, { title: "Accueil", slug: "accueil" })
  await owner.mutation(api.pages.create, { title: "Contact", slug: "contact" })
  await owner.mutation(api.pages.create, { title: "Disparue", slug: "disparue" })
  await owner.mutation(api.settings.setHomePage, { slug: "accueil" })

  const list = await owner.query(api.pages.list, {})
  const par = (slug: string) => list.find((page) => page.slug === slug)

  // `accueil` n'est PAS dans le manifeste — c'est `/` qui l'est, servi par
  // `index.astro`. Sans l'exception, la page la plus servie du site était
  // signalée comme absente.
  // Le chemin affiché est celui qui répond, pas le slug : montrer
  // `/accueil` donnait une adresse qui rend 404, sur la page la plus
  // visitée du site.
  expect(par("accueil")?.path).toBe("/")
  expect(par("contact")?.path).toBe("/contact")
  expect(par("accueil")?.servedByRoute).toBe(true)
  expect(par("contact")?.servedByRoute).toBe(true)
  // Celle-là n'a vraiment aucun fichier : le signalement doit rester utile.
  expect(par("disparue")?.servedByRoute).toBe(false)
})

// Les trois pages réglementaires ne peuvent ni se dépublier ni se
// supprimer. Elles sont référencées par le pied de page et par le bandeau
// de cookies depuis TOUTES les pages du site : les retirer laisse des liens
// morts à l'endroit exact où un visiteur doit pouvoir s'informer avant de
// décider, et le lien mort ne se voit depuis aucun écran de
// l'administration. Voir `lib/requiredPages.ts`.

async function pagePubliee(t: TestConvex<typeof schema>, slug: string, authorId: string) {
  return t.run((ctx) =>
    ctx.db.insert("pages", {
      slug,
      title: "Page",
      status: "published" as const,
      createdBy: authorId,
      updatedBy: authorId,
      publishedAt: Date.now(),
    }),
  )
}

test("une page réglementaire ne peut pas être dépubliée", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await pagePubliee(t, "cookies", owner.id)

  await expect(owner.identity.mutation(api.pages.unpublish, { id })).rejects.toMatchObject({
    data: { code: "REQUIRED_PAGE" },
  })
  expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("published")
})

test("une page réglementaire ne peut pas être supprimée", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await pagePubliee(t, "confidentialite", owner.id)

  await expect(owner.identity.mutation(api.pages.remove, { id })).rejects.toMatchObject({
    data: { code: "REQUIRED_PAGE" },
  })
  expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull()
})

test("le refus est étroit : une page ordinaire se dépublie toujours", async () => {
  // Le garde-fou porte sur trois slugs, pas sur le principe de dépublier.
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await pagePubliee(t, "tarifs", owner.id)

  await owner.identity.mutation(api.pages.unpublish, { id })
  expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("draft")
})

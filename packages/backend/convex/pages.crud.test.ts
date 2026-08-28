import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { getFunctionName } from "convex/server"
import { verifyPreviewToken } from "./lib/previewToken"
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
  expect(page?.blocks).toEqual([])
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
      blocks: [],
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

test("update refuse un id inexistant", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "temp", createdBy: owner.id })
  await t.run((ctx) => ctx.db.delete(id))
  await expect(
    owner.identity.mutation(api.pages.update, { id, title: "x" }),
  ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } })
})

test("update refuse un bloc dont un champ dépasse sa limite (hero.title)", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "bloc-trop-long", createdBy: owner.id })
  await expect(
    owner.identity.mutation(api.pages.update, {
      id,
      blocks: [{ type: "hero", title: "x".repeat(500) }],
    }),
  ).rejects.toMatchObject({ data: { code: "FIELD_TOO_LONG", field: "hero.title" } })
})

test("update accepte des blocs valides et les enregistre dans l'ordre fourni", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "reorder", createdBy: owner.id })
  await owner.identity.mutation(api.pages.update, {
    id,
    blocks: [
      { type: "richText", html: "<p>Un</p>" },
      { type: "hero", title: "Deux" },
    ],
  })
  const page = await t.run((ctx) => ctx.db.get(id))
  expect(page?.blocks.map((b) => b.type)).toEqual(["richText", "hero"])
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

test("mintPreviewToken renvoie un jeton vérifié avec succès par verifyPreviewToken", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await insertOwnedPage(t, { slug: "a-previsualiser", createdBy: owner.id })
  const { token } = await owner.identity.mutation(api.pages.mintPreviewToken, { id })
  const valid = await verifyPreviewToken({ type: "page", id, token })
  expect(valid).toBe(true)
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
      status: "done",
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
    }),
  )
  const status = await owner.identity.query(api.pages.publicationStatus, { id })
  expect(status?.state).toBe("published")
})

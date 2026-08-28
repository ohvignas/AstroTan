import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import { api } from "./_generated/api"
import {
  ALLOWED_MIME_TYPES,
  MAX_ALT_LENGTH,
  MAX_FILENAME_LENGTH,
  MAX_MEDIA_SIZE_BYTES,
} from "./media"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

// Même préambule que les autres suites : `createAuth` refuse de démarrer
// sans secret, et c'est délibéré (un déploiement sans `BETTER_AUTH_SECRET`
// signerait des jetons avec une valeur par défaut connue).
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
  const email = `media-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple media"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  const identity = await identityFor(t, user.id)
  return { identity, id: user.id }
}

async function storeBlob(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => ctx.storage.store(new Blob(["x"])))
}

const VALID = { filename: "photo.png", mime: "image/png", size: 1024, alt: "Une photo" }

// ---------------------------------------------------------------------
// L'alternative textuelle est obligatoire
// ---------------------------------------------------------------------

// Une image sans `alt` est un défaut d'accessibilité qu'aucune interface ne
// rattrape ensuite — et un `alt` qu'on peut remplir « plus tard » n'est
// jamais rempli. C'est pourquoi la contrainte vit ici, pas seulement dans
// le formulaire de téléversement.

test("register refuse un alt vide", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const storageId = await storeBlob(t)

  await expect(
    editor.identity.mutation(api.media.register, { ...VALID, storageId, alt: "" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_ALT" } })
})

test("register refuse un alt fait uniquement d'espaces", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const storageId = await storeBlob(t)

  await expect(
    editor.identity.mutation(api.media.register, { ...VALID, storageId, alt: "   " }),
  ).rejects.toMatchObject({ data: { code: "INVALID_ALT" } })
})

test("register refuse un alt au-delà de sa borne, et l'accepte à la borne", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")

  await expect(
    editor.identity.mutation(api.media.register, {
      ...VALID,
      storageId: await storeBlob(t),
      alt: "x".repeat(MAX_ALT_LENGTH + 1),
    }),
  ).rejects.toMatchObject({ data: { code: "FIELD_TOO_LONG", field: "alt" } })

  const id = await editor.identity.mutation(api.media.register, {
    ...VALID,
    storageId: await storeBlob(t),
    alt: "x".repeat(MAX_ALT_LENGTH),
  })
  expect(id).toBeDefined()
})

// ---------------------------------------------------------------------
// Liste blanche de types MIME
// ---------------------------------------------------------------------

test("register refuse image/svg+xml", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const storageId = await storeBlob(t)

  // Un SVG est un document exécutable : servi depuis l'origine du site, il
  // est un vecteur XSS. C'est le cas qui justifie une liste blanche plutôt
  // qu'une liste noire — un format d'image « en apparence ».
  await expect(
    editor.identity.mutation(api.media.register, {
      ...VALID,
      storageId,
      filename: "logo.svg",
      mime: "image/svg+xml",
    }),
  ).rejects.toMatchObject({ data: { code: "UNSUPPORTED_MIME" } })
})

test("register refuse un type hors image, et accepte chacun des types autorisés", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")

  await expect(
    editor.identity.mutation(api.media.register, {
      ...VALID,
      storageId: await storeBlob(t),
      filename: "notes.pdf",
      mime: "application/pdf",
    }),
  ).rejects.toMatchObject({ data: { code: "UNSUPPORTED_MIME" } })

  for (const mime of ALLOWED_MIME_TYPES) {
    const id = await editor.identity.mutation(api.media.register, {
      ...VALID,
      storageId: await storeBlob(t),
      mime,
    })
    expect(id).toBeDefined()
  }
})

// ---------------------------------------------------------------------
// Bornes restantes
// ---------------------------------------------------------------------

test("register refuse un fichier au-delà de la taille maximale", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")

  await expect(
    editor.identity.mutation(api.media.register, {
      ...VALID,
      storageId: await storeBlob(t),
      size: MAX_MEDIA_SIZE_BYTES + 1,
    }),
  ).rejects.toMatchObject({ data: { code: "FILE_TOO_LARGE" } })
})

test("register refuse un nom de fichier vide ou trop long", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")

  await expect(
    editor.identity.mutation(api.media.register, {
      ...VALID,
      storageId: await storeBlob(t),
      filename: "",
    }),
  ).rejects.toMatchObject({ data: { code: "INVALID_FILENAME" } })

  await expect(
    editor.identity.mutation(api.media.register, {
      ...VALID,
      storageId: await storeBlob(t),
      filename: "x".repeat(MAX_FILENAME_LENGTH + 1),
    }),
  ).rejects.toMatchObject({ data: { code: "FIELD_TOO_LONG", field: "filename" } })
})

test("register refuse d'enregistrer deux fois le même fichier", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const storageId = await storeBlob(t)

  await editor.identity.mutation(api.media.register, { ...VALID, storageId })
  // Sans ça, `by_storage` cesse d'être une correspondance un-à-un et la
  // résolution d'un `alt` depuis un `storageId` devient ambiguë.
  await expect(
    editor.identity.mutation(api.media.register, { ...VALID, storageId }),
  ).rejects.toMatchObject({ data: { code: "ALREADY_REGISTERED" } })
})

// ---------------------------------------------------------------------
// Suppression : jamais une référence dans le vide
// ---------------------------------------------------------------------

test("remove refuse un média encore utilisé comme image OpenGraph d'une page", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const storageId = await storeBlob(t)
  const mediaId = await owner.identity.mutation(api.media.register, { ...VALID, storageId })

  const pageId = await owner.identity.mutation(api.pages.create, {
    title: "Page qui utilise l'image",
    slug: "page-avec-image",
  })
  await owner.identity.mutation(api.pages.update, {
    id: pageId,
    seo: { ogImageId: storageId },
  })

  await expect(
    owner.identity.mutation(api.media.remove, { id: mediaId }),
  ).rejects.toMatchObject({ data: { code: "MEDIA_IN_USE" } })

  // La ligne survit au refus : un refus n'est pas une suppression partielle.
  const row = await t.run((ctx) => ctx.db.get(mediaId))
  expect(row).not.toBeNull()
})

test("remove supprime la ligne ET le fichier quand plus rien ne le référence", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const storageId = await storeBlob(t)
  const mediaId = await owner.identity.mutation(api.media.register, { ...VALID, storageId })

  await owner.identity.mutation(api.media.remove, { id: mediaId })

  expect(await t.run((ctx) => ctx.db.get(mediaId))).toBeNull()
  // Supprimer la ligne sans le fichier laisserait un octet payant et
  // inatteignable — invisible dans l'interface, facturé quand même.
  expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull()
})

test("un editor ne peut supprimer que ses propres médias", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const ownerMedia = await owner.identity.mutation(api.media.register, {
    ...VALID,
    storageId: await storeBlob(t),
  })

  const editor = await seedActor(t, "editor")
  await expect(
    editor.identity.mutation(api.media.remove, { id: ownerMedia }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })

  const own = await editor.identity.mutation(api.media.register, {
    ...VALID,
    storageId: await storeBlob(t),
  })
  await editor.identity.mutation(api.media.remove, { id: own })
  expect(await t.run((ctx) => ctx.db.get(own))).toBeNull()
})

// ---------------------------------------------------------------------
// Le sidecar est facultatif par construction
// ---------------------------------------------------------------------

test("un storageId sans ligne media reste lisible — il n'y a simplement pas d'alt", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  // Décision 1 du plan : `media` porte les métadonnées, les champs qui
  // désignent un fichier référencent `_storage` directement. Un fichier
  // téléversé hors médiathèque n'a donc pas de ligne ici, et le rendu doit
  // le supporter plutôt que d'échouer.
  const orphan = await storeBlob(t)
  expect(await owner.identity.query(api.media.byStorageId, { storageId: orphan })).toBeNull()

  const known = await storeBlob(t)
  await owner.identity.mutation(api.media.register, { ...VALID, storageId: known })
  const found = await owner.identity.query(api.media.byStorageId, { storageId: known })
  expect(found?.alt).toBe(VALID.alt)
})

// ---------------------------------------------------------------------
// updateAlt
// ---------------------------------------------------------------------

test("updateAlt remplace l'alternative textuelle et refuse de la vider", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.media.register, {
    ...VALID,
    storageId: await storeBlob(t),
  })

  await owner.identity.mutation(api.media.updateAlt, { id, alt: "Un autre texte" })
  expect((await t.run((ctx) => ctx.db.get(id)))?.alt).toBe("Un autre texte")

  await expect(
    owner.identity.mutation(api.media.updateAlt, { id, alt: "  " }),
  ).rejects.toMatchObject({ data: { code: "INVALID_ALT" } })
})

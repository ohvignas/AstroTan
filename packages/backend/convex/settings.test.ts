import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import { api } from "./_generated/api"
import { MAX_SITE_NAME_LENGTH } from "./settings"
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
  const email = `settings-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple settings"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

test("get rend null sur un site jamais configuré, sans exiger de session", async () => {
  const t = makeTestConvex()
  // Appelé sans identité : `apps/web` n'a ni session ni clé admin et a
  // besoin du nom et du logo sur chaque page.
  expect(await t.query(api.settings.get, {})).toBeNull()
  expect(await t.query(api.settings.homePageSlug, {})).toBeNull()
})

test("update crée la ligne au premier enregistrement, puis la modifie", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  await owner.identity.mutation(api.settings.update, { siteName: "Illith" })
  expect((await t.query(api.settings.get, {}))?.siteName).toBe("Illith")

  await owner.identity.mutation(api.settings.update, { siteName: "Illith École" })
  const rows = await t.run((ctx) => ctx.db.query("settings").collect())
  // Singleton : modifier, jamais empiler une seconde ligne.
  expect(rows).toHaveLength(1)
  expect(rows[0]?.siteName).toBe("Illith École")
})

// Relecture finale, correctif 1 : `emailFrom` n'est plus dans `get`, la
// projection publique non authentifiée — voir `settings.publicProjection
// .test.ts`. Ce n'est pas un secret pour autant (elle apparaît dans
// l'en-tête de chaque email envoyé), donc `getPrivate` — réservée à une
// session owner/admin/editor — continue de la rendre.
test("update accepte emailFrom ; getPrivate l'expose, get ne l'expose plus", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  await owner.identity.mutation(api.settings.update, {
    siteName: "Illith",
    emailFrom: "AstroTan <bonjour@exemple.fr>",
  })
  expect((await owner.identity.query(api.settings.getPrivate, {}))?.emailFrom).toBe(
    "AstroTan <bonjour@exemple.fr>"
  )
  expect(await t.query(api.settings.get, {})).not.toHaveProperty("emailFrom")
})

test("update refuse un nom vide ou trop long, et n'est pas ouvert aux editors", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  await expect(
    owner.identity.mutation(api.settings.update, { siteName: "   " }),
  ).rejects.toMatchObject({ data: { code: "INVALID_SITE_NAME" } })
  await expect(
    owner.identity.mutation(api.settings.update, {
      siteName: "x".repeat(MAX_SITE_NAME_LENGTH + 1),
    }),
  ).rejects.toMatchObject({ data: { code: "FIELD_TOO_LONG", field: "siteName" } })

  const editor = await seedActor(t, "editor")
  await expect(
    editor.identity.mutation(api.settings.update, { siteName: "Détourné" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
})

test("setHomePage refuse une page qui n'existe pas", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  // Pointer `/` sur une page inexistante mettrait la porte d'entrée du
  // site en 404, sans rien dans le tableau de bord pour dire pourquoi.
  await expect(
    owner.identity.mutation(api.settings.setHomePage, { slug: "fantome" }),
  ).rejects.toMatchObject({ data: { code: "UNKNOWN_PAGE" } })
})

test("setHomePage désigne la page, et null la libère", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.pages.create, { title: "Accueil", slug: "accueil" })

  await owner.identity.mutation(api.settings.setHomePage, { slug: "accueil" })
  expect(await t.query(api.settings.homePageSlug, {})).toBe("accueil")

  await owner.identity.mutation(api.settings.setHomePage, { slug: null })
  expect(await t.query(api.settings.homePageSlug, {})).toBeNull()
})

test("renommer le slug de la page d'accueil suit dans les réglages", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.pages.create, {
    title: "Accueil",
    slug: "accueil",
  })
  await owner.identity.mutation(api.settings.setHomePage, { slug: "accueil" })

  await owner.identity.mutation(api.pages.update, { id, slug: "home" })

  // Sans ce suivi, `/` pointerait sur un slug que plus aucune page ne
  // porte, et le site n'aurait plus de page d'accueil.
  expect(await t.query(api.settings.homePageSlug, {})).toBe("home")
})

test("renommer une page ordinaire ne touche pas à la page d'accueil", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.pages.create, { title: "Accueil", slug: "accueil" })
  const autre = await owner.identity.mutation(api.pages.create, {
    title: "Autre",
    slug: "autre",
  })
  await owner.identity.mutation(api.settings.setHomePage, { slug: "accueil" })

  await owner.identity.mutation(api.pages.update, { id: autre, slug: "autre-renomme" })
  expect(await t.query(api.settings.homePageSlug, {})).toBe("accueil")
})

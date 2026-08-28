// L'invariant qui justifie toute la conception de la barre
// d'enregistrement de l'administration (`apps/admin/src/components/
// save-bar.tsx`) : une sauvegarde automatique ne frappe **aucune**
// redirection.
//
// Le danger est réel et il a un nom : `mintRenameRedirect`
// (`convex/redirects.ts`), appelé par `pages.update` et `posts.update` dès
// que le slug d'un document publié change. Une sauvegarde qui suivrait la
// frappe dans le champ « Slug » créerait une 301 par valeur intermédiaire —
// `/tar`, `/tari`, `/tarif` — et ces lignes ne sont pas inertes : elles
// occupent ensuite ces chemins et refusent la création d'une page qui les
// porterait (`assertPathAvailable`).
//
// La parade est côté client : la charge utile automatique omet `slug`.
// Ce fichier vérifie que cette omission suffit, c'est-à-dire que le serveur
// ne dérive pas un renommage de quoi que ce soit d'autre. Le dernier test
// tient le contrefactuel : la même séquence *avec* le slug produit bien la
// traînée de redirections qu'on cherche à éviter.
import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import { api } from "./_generated/api"
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

async function seedOwner(t: TestConvex<typeof schema>) {
  const email = `autosave-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple autosave"
  const user = await seedUser(t, { email, password, name: "Autosave", role: "owner" })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

// Les valeurs intermédiaires qu'un opérateur produit en tapant « tarifs »
// dans le champ « Slug », une pause de frappe après l'autre.
const KEYSTROKES = ["t", "ta", "tar", "tari", "tarif", "tarifs"]

test("la charge utile de la sauvegarde automatique d'une page ne crée aucune redirection", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  const id = await owner.identity.mutation(api.pages.create, {
    title: "Offre",
    slug: "offre",
  })
  // Publiée : c'est la seule condition dans laquelle `pages.update` frappe
  // une 301. Un brouillon n'en produirait jamais, et le test ne prouverait
  // rien.
  await owner.identity.mutation(api.pages.publishPage, { id })

  // Exactement ce que `saveAuto` envoie : titre, SEO, GEO — pas de `slug`.
  for (const keystroke of KEYSTROKES) {
    await owner.identity.mutation(api.pages.update, {
      id,
      title: `Offre ${keystroke}`,
      seo: { description: keystroke },
      geo: { summary: keystroke, entities: [keystroke], faq: [] },
    })
  }

  expect(await t.query(api.redirects.listActive, {})).toEqual([])
  // Et le slug enregistré n'a pas bougé d'un caractère : un argument omis
  // laisse la valeur stockée intacte.
  expect((await t.run((ctx) => ctx.db.get(id)))?.slug).toBe("offre")
})

test("la charge utile de la sauvegarde automatique d'un article ne crée aucune redirection", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Billet",
    slug: "billet",
  })
  await owner.identity.mutation(api.posts.publishPost, { id })

  for (const keystroke of KEYSTROKES) {
    await owner.identity.mutation(api.posts.update, {
      id,
      title: `Billet ${keystroke}`,
      body: `Corps ${keystroke}`,
      excerpt: keystroke,
    })
  }

  expect(await t.query(api.redirects.listActive, {})).toEqual([])
  expect((await t.run((ctx) => ctx.db.get(id)))?.slug).toBe("billet")
})

test("un seul clic sur Enregistrer produit une seule redirection", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  const id = await owner.identity.mutation(api.pages.create, {
    title: "Offre",
    slug: "offre",
  })
  await owner.identity.mutation(api.pages.publishPage, { id })

  // Le geste explicite : la valeur finale, une fois.
  await owner.identity.mutation(api.pages.update, { id, slug: "tarifs" })

  expect(await t.query(api.redirects.listActive, {})).toEqual([
    { from: "offre", to: "/tarifs", code: 301 },
  ])
})

test("le contrefactuel : envoyer le slug à chaque frappe laisse bien une traînée", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  const id = await owner.identity.mutation(api.pages.create, {
    title: "Offre",
    slug: "offre",
  })
  await owner.identity.mutation(api.pages.publishPage, { id })

  for (const keystroke of KEYSTROKES) {
    await owner.identity.mutation(api.pages.update, { id, slug: keystroke })
  }

  // Voilà ce que la barre évite : six chemins d'une à six lettres,
  // définitivement occupés par des redirections que personne ne saura
  // relier à leur cause.
  const rows = await t.query(api.redirects.listActive, {})
  expect(rows.map((row) => row.from).sort()).toEqual([
    "offre",
    "t",
    "ta",
    "tar",
    "tari",
    "tarif",
  ])
})

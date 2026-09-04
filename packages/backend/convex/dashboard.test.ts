import type { TestConvex } from "convex-test"
import { beforeEach, expect, test } from "vitest"
import schema from "./schema"
import { api } from "./_generated/api"
import { COUNT_CAP, tally } from "./dashboard"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
})

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor",
) {
  const email = `dashboard-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple dashboard"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

test("refuse un appelant sans session", async () => {
  const t = makeTestConvex()
  // Le tableau de bord agrège des chiffres qui n'ont rien de public :
  // combien de brouillons, combien de personnes ont écrit. L'accueil de
  // l'administration est derrière une session comme le reste.
  await expect(t.query(api.dashboard.overview, {})).rejects.toThrow()
})

test("un éditeur voit les contenus, jamais les comptes ni les redirections", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")

  const o = await editor.identity.query(api.dashboard.overview, {})
  // Les frontières existantes sont recopiées, pas élargies : `users.list`
  // et `redirects.list` sont réservées à owner/admin, et une query de
  // synthèse qui rendrait ces mêmes nombres à un éditeur serait une porte
  // dérobée vers ce que les autres écrans lui refusent.
  expect(o.users).toBeNull()
  expect(o.redirects).toBeNull()
  // Ce qu'il a le droit d'éditer, il a le droit de le compter.
  expect(o.pages).not.toBeNull()
  expect(o.leads).not.toBeNull()
})

test("compte les pages publiées et les brouillons séparément", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await t.run(async (ctx) => {
    for (const [slug, status] of [
      ["accueil", "published"],
      ["contact", "published"],
      ["tarifs", "draft"],
    ] as const) {
      await ctx.db.insert("pages", {
        slug,
        title: slug,
        status,
        createdBy: "u",
        updatedBy: "u",
      })
    }
  })

  const o = await owner.identity.query(api.dashboard.overview, {})
  expect(o.pages.published.count).toBe(2)
  expect(o.pages.draft.count).toBe(1)
})

test("les articles portent la date du dernier publié, pas celle du dernier écrit", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await t.run(async (ctx) => {
    await ctx.db.insert("posts", {
      slug: "vieux",
      title: "Vieux",
      body: "",
      status: "published",
      publishedAt: 1000,
      tagIds: [],
      createdBy: "u",
      updatedBy: "u",
    })
    await ctx.db.insert("posts", {
      slug: "recent",
      title: "Récent",
      body: "",
      status: "published",
      publishedAt: 5000,
      tagIds: [],
      createdBy: "u",
      updatedBy: "u",
    })
    // Un brouillon écrit après coup ne déplace pas la date : ce qu'on veut
    // savoir est « depuis quand le blog n'a rien montré », pas « depuis
    // quand personne n'a tapé ».
    await ctx.db.insert("posts", {
      slug: "brouillon",
      title: "Brouillon",
      body: "",
      status: "draft",
      tagIds: [],
      createdBy: "u",
      updatedBy: "u",
    })
  })

  const o = await owner.identity.query(api.dashboard.overview, {})
  expect(o.posts.published.count).toBe(2)
  expect(o.posts.draft.count).toBe(1)
  expect(o.posts.lastPublishedAt).toBe(5000)
})

test("sans aucun article publié, la date vaut null plutôt que zéro", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  // Zéro est une date : le 1er janvier 1970. Le rendre ferait afficher
  // « dernier article : il y a 56 ans » sur un blog qui n'a rien publié.
  const o = await owner.identity.query(api.dashboard.overview, {})
  expect(o.posts.lastPublishedAt).toBeNull()
})

test("les cinq colonnes de leads sont toujours présentes, même vides", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await t.run(async (ctx) => {
    for (const [email, status] of [
      ["a@x.test", "new"],
      ["b@x.test", "new"],
      ["c@x.test", "won"],
    ] as const) {
      await ctx.db.insert("leads", {
        name: email,
        email,
        status,
        lastMessageAt: 1,
        messageCount: 1,
      })
    }
  })

  const o = await owner.identity.query(api.dashboard.overview, {})
  // Une colonne absente et une colonne à zéro se ressemblent dans un
  // tableau de bord, et ne veulent pas dire la même chose. Les cinq sont
  // rendues, dérivées de `LEAD_STATUSES` : ajouter une colonne au tableau
  // ne demandera pas d'y penser ici.
  expect(Object.keys(o.leads.byStatus).sort()).toEqual([
    "contacted",
    "lost",
    "new",
    "qualified",
    "won",
  ])
  expect(o.leads.byStatus.new.count).toBe(2)
  expect(o.leads.byStatus.won.count).toBe(1)
  expect(o.leads.byStatus.lost.count).toBe(0)
  expect(o.leads.total.count).toBe(3)
  // Les trois n'ont pas de seenAt : « nouveau » = pas encore ouvert.
  expect(o.leads.unseen.count).toBe(3)
})

test("le compteur unseen ignore les fiches déjà ouvertes", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await t.run(async (ctx) => {
    await ctx.db.insert("leads", {
      name: "lu",
      email: "lu@x.test",
      status: "new",
      lastMessageAt: 1,
      messageCount: 1,
      seenAt: 99,
    })
    await ctx.db.insert("leads", {
      name: "pas-lu",
      email: "pas-lu@x.test",
      status: "contacted",
      lastMessageAt: 2,
      messageCount: 1,
    })
  })

  const o = await owner.identity.query(api.dashboard.overview, {})
  expect(o.leads.total.count).toBe(2)
  expect(o.leads.unseen.count).toBe(1)
  expect(o.leads.byStatus.new.count).toBe(1)
})

test("la médiathèque rend un nombre de fichiers et un poids total", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["a"]))
    await ctx.db.insert("media", {
      storageId,
      filename: "un.png",
      mime: "image/png",
      alt: "un",
      size: 1200,
      createdBy: "u",
    })
    await ctx.db.insert("media", {
      storageId,
      filename: "deux.png",
      mime: "image/png",
      alt: "deux",
      size: 800,
      createdBy: "u",
    })
  })

  const o = await owner.identity.query(api.dashboard.overview, {})
  expect(o.media.files.count).toBe(2)
  expect(o.media.bytes).toBe(2000)
})

test("les invitations en attente excluent les acceptées et les expirées", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const now = Date.now()
  await t.run(async (ctx) => {
    await ctx.db.insert("invitations", {
      email: "attente@x.test",
      role: "editor",
      tokenHash: "h1",
      expiresAt: now + 86400000,
      invitedBy: "u",
    })
    await ctx.db.insert("invitations", {
      email: "acceptee@x.test",
      role: "editor",
      tokenHash: "h2",
      expiresAt: now + 86400000,
      invitedBy: "u",
      acceptedAt: now,
    })
    await ctx.db.insert("invitations", {
      email: "expiree@x.test",
      role: "editor",
      tokenHash: "h3",
      expiresAt: now - 1,
      invitedBy: "u",
    })
  })

  // « En attente » veut dire actionnable : une invitation périmée ne
  // deviendra jamais un compte, et la compter ferait attendre quelqu'un
  // qui ne viendra pas.
  const o = await owner.identity.query(api.dashboard.overview, {})
  expect(o.users?.pendingInvitations.count).toBe(1)
})

test("les comptes existants sont comptés, l'appelant compris", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await seedUser(t, {
    email: `second-${Date.now()}@example.com`,
    password: "correct horse battery staple dashboard",
    name: "Second",
    role: "editor",
  })

  const o = await owner.identity.query(api.dashboard.overview, {})
  expect(o.users?.total.count).toBe(2)
})

test("les redirections comptent les actives à part du total", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await t.run(async (ctx) => {
    await ctx.db.insert("redirects", {
      from: "ancien",
      to: "/nouveau",
      code: 301,
      enabled: true,
      createdBy: "u",
    })
    await ctx.db.insert("redirects", {
      from: "eteint",
      to: "/nouveau",
      code: 302,
      enabled: false,
      createdBy: "u",
    })
  })

  // Une redirection désactivée existe encore et ne redirige rien : les
  // additionner ferait croire que deux chemins sont couverts.
  const o = await owner.identity.query(api.dashboard.overview, {})
  expect(o.redirects?.enabled.count).toBe(1)
  expect(o.redirects?.total.count).toBe(2)
})

test("au-delà du plafond, le compte se déclare tronqué au lieu de mentir", async () => {
  // Exercé sur un faux `.take()` plutôt qu'en insérant mille et une
  // lignes : ce qui est testé est la décision (« ai-je vu plus que je ne
  // peux compter ? »), et la payer par mille écritures dans chaque suite
  // ne la testerait pas mieux.
  const plein = await tally({ take: async (n: number) => new Array(n).fill(null) })
  expect(plein).toEqual({ count: COUNT_CAP, capped: true })

  const partiel = await tally({ take: async () => new Array(3).fill(null) })
  expect(partiel).toEqual({ count: 3, capped: false })
})

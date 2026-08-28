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

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor"
) {
  const email = `redirects-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple redirects"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

// ---------------------------------------------------------------------
// LE test du lot : le troisième point d'écriture
// ---------------------------------------------------------------------

test("réactiver une redirection désactivée ne peut pas masquer une page créée entre-temps", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  // 1. La redirection est créée alors qu'aucune page ne porte ce chemin.
  const id = await owner.identity.mutation(api.redirects.create, {
    from: "offre-2025",
    to: "/tarifs",
    code: 301,
  })

  // 2. On la désactive.
  await owner.identity.mutation(api.redirects.update, { id, enabled: false })

  // 3. Une page prend le chemin — accepté, la redirection est inactive.
  await owner.identity.mutation(api.pages.create, {
    title: "Offre 2025",
    slug: "offre-2025",
  })

  // 4. On la réactive. Sans garde à ce troisième point d'écriture, la page
  //    est masquée sans qu'aucune des deux autres vérifications n'ait
  //    jamais été franchie — c'est exactement le contournement.
  await expect(
    owner.identity.mutation(api.redirects.update, { id, enabled: true }),
  ).rejects.toMatchObject({ data: { code: "PATH_ALREADY_SERVED", reason: "page" } })
})

// ---------------------------------------------------------------------
// Les quatre sources de vérité
// ---------------------------------------------------------------------

test("create refuse un chemin servi par un fichier de route", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  // Une page designée n'est ni une ligne publiée ni un chemin prérendu :
  // c'est un fichier `.astro`. C'est la source de vérité que le premier
  // plan de ce lot avait manquée.
  await expect(
    owner.identity.mutation(api.redirects.create, { from: "contact", to: "/", code: 301 }),
  ).rejects.toMatchObject({ data: { code: "PATH_ALREADY_SERVED", reason: "route" } })

  // `/blog` lui-même est un chemin exact (`blog/index.astro`).
  await expect(
    owner.identity.mutation(api.redirects.create, { from: "blog", to: "/", code: 301 }),
  ).rejects.toMatchObject({ data: { code: "PATH_ALREADY_SERVED" } })
})

test("un chemin sous une route dynamique n'est occupé que si l'article existe", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")

  // `/blog/<slug>` est résolu contre la base : sans article, il rend 404,
  // et le rediriger est exactement ce qu'on veut après un renommage.
  const id = await owner.identity.mutation(api.redirects.create, {
    from: "blog/article-disparu",
    to: "/blog/nouveau",
    code: 301,
  })
  expect(id).toBeDefined()

  // Mais un article vivant occupe bien son chemin.
  await owner.identity.mutation(api.posts.create, {
    title: "Vivant",
    slug: "article-vivant",
  })
  await expect(
    owner.identity.mutation(api.redirects.create, {
      from: "blog/article-vivant",
      to: "/",
      code: 301,
    }),
  ).rejects.toMatchObject({ data: { code: "PATH_ALREADY_SERVED", reason: "post" } })
})

test("renommer un article publié crée une 301 depuis son ancienne URL", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Article",
    slug: "titre-v1",
  })
  await owner.identity.mutation(api.posts.publishPost, { id })

  await owner.identity.mutation(api.posts.update, { id, slug: "titre-v2" })

  expect(await t.query(api.redirects.listActive, {})).toContainEqual({
    from: "blog/titre-v1",
    to: "/blog/titre-v2",
    code: 301,
  })
})

test("create refuse le chemin d'une page, même en brouillon", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.pages.create, { title: "Tarifs", slug: "tarifs" })

  // Les brouillons comptent : une redirection créée pendant qu'une page est
  // encore en brouillon la masquerait dès sa publication, et rien ne
  // relierait les deux événements.
  await expect(
    owner.identity.mutation(api.redirects.create, { from: "tarifs", to: "/", code: 301 }),
  ).rejects.toMatchObject({ data: { code: "PATH_ALREADY_SERVED", reason: "page" } })
})

test("create refuse un slug réservé", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await expect(
    owner.identity.mutation(api.redirects.create, { from: "blog", to: "/", code: 301 }),
  ).rejects.toMatchObject({ data: { code: "PATH_ALREADY_SERVED" } })
})

// ---------------------------------------------------------------------
// Destination et forme
// ---------------------------------------------------------------------

test("create refuse une destination non sûre", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  for (const to of ["javascript:alert(1)", "//evil.example", "/\\evil.example"]) {
    await expect(
      owner.identity.mutation(api.redirects.create, { from: "ancien", to, code: 301 }),
    ).rejects.toMatchObject({ data: { code: "UNSAFE_HREF", field: "to" } })
  }
})

test("create refuse une boucle sur elle-même", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await expect(
    owner.identity.mutation(api.redirects.create, {
      from: "boucle",
      to: "/boucle",
      code: 301,
    }),
  ).rejects.toMatchObject({ data: { code: "REDIRECT_LOOP" } })
})

test("create refuse un from déjà pris", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.redirects.create, {
    from: "ancien",
    to: "/tarifs",
    code: 301,
  })
  await expect(
    owner.identity.mutation(api.redirects.create, {
      from: "ancien",
      to: "/autre",
      code: 302,
    }),
  ).rejects.toMatchObject({ data: { code: "FROM_ALREADY_EXISTS" } })
})

test("un editor ne peut pas créer de redirection", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  await expect(
    editor.identity.mutation(api.redirects.create, {
      from: "ancien",
      to: "/tarifs",
      code: 301,
    }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } })
})

// ---------------------------------------------------------------------
// Lecture publique
// ---------------------------------------------------------------------

test("listActive ne rend que les redirections actives, sans session", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const actif = await owner.identity.mutation(api.redirects.create, {
    from: "actif",
    to: "/tarifs",
    code: 301,
  })
  const inactif = await owner.identity.mutation(api.redirects.create, {
    from: "inactif",
    to: "/tarifs",
    code: 301,
  })
  await owner.identity.mutation(api.redirects.update, { id: inactif, enabled: false })

  // Appelée sans identité : le middleware d'`apps/web` n'a ni session ni
  // clé admin.
  const rows = await t.query(api.redirects.listActive, {})
  expect(rows.map((r) => r.from)).toEqual(["actif"])
  expect(actif).toBeDefined()
})

// ---------------------------------------------------------------------
// La réciproque, et le 301 automatique
// ---------------------------------------------------------------------

test("pages.create refuse un slug qu'une redirection active sert déjà", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.redirects.create, {
    from: "ancienne-offre",
    to: "/tarifs",
    code: 301,
  })

  // Sans cette garde, la page naîtrait invisible : le middleware la
  // redirigerait avant que sa route ne soit atteinte.
  await expect(
    owner.identity.mutation(api.pages.create, {
      title: "Ancienne offre",
      slug: "ancienne-offre",
    }),
  ).rejects.toMatchObject({ data: { code: "SLUG_HAS_REDIRECT" } })
})

test("une redirection désactivée ne bloque pas la création d'une page", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.redirects.create, {
    from: "libre",
    to: "/tarifs",
    code: 301,
  })
  await owner.identity.mutation(api.redirects.update, { id, enabled: false })

  // Elle ne masque rien tant qu'elle est inactive ; c'est sa réactivation
  // qui est refusée, pas la création de la page.
  const pageId = await owner.identity.mutation(api.pages.create, {
    title: "Libre",
    slug: "libre",
  })
  expect(pageId).toBeDefined()
})

test("renommer une page publiée crée une 301 depuis l'ancien chemin", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.pages.create, {
    title: "Offre",
    slug: "offre-v1",
  })
  await owner.identity.mutation(api.pages.publishPage, { id })

  await owner.identity.mutation(api.pages.update, { id, slug: "offre-v2" })

  // L'ancienne URL vit dans des favoris, des liens entrants, l'index d'un
  // moteur. Une 301 les fait suivre au lieu de les abandonner en 404.
  const rows = await t.query(api.redirects.listActive, {})
  expect(rows).toContainEqual({ from: "offre-v1", to: "/offre-v2", code: 301 })
})

test("renommer un brouillon jamais publié ne crée aucune redirection", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.pages.create, {
    title: "Brouillon",
    slug: "essai-1",
  })

  await owner.identity.mutation(api.pages.update, { id, slug: "essai-2" })
  await owner.identity.mutation(api.pages.update, { id, slug: "essai-3" })

  // Sinon renommer trois fois un brouillon laisserait trois redirections
  // mortes, qui bloqueraient ensuite la création d'une page sur ces chemins.
  expect(await t.query(api.redirects.listActive, {})).toEqual([])
})

test("le 301 automatique et la page d'accueil coexistent", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.pages.create, {
    title: "Accueil",
    slug: "accueil-v1",
  })
  await owner.identity.mutation(api.pages.publishPage, { id })
  await owner.identity.mutation(api.settings.setHomePage, { slug: "accueil-v1" })

  await owner.identity.mutation(api.pages.update, { id, slug: "accueil-v2" })

  // Les deux mécanismes suivent le renommage sans se marcher dessus.
  expect(await t.query(api.settings.homePageSlug, {})).toBe("accueil-v2")
  expect(await t.query(api.redirects.listActive, {})).toContainEqual({
    from: "accueil-v1",
    to: "/accueil-v2",
    code: 301,
  })
})

test("renommer le slug d'une page servie par un fichier de route est refusé", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  // `contact` est servi par `apps/web/src/pages/contact.astro`, présent
  // dans le manifeste engendré.
  const id = await owner.identity.mutation(api.pages.create, {
    title: "Contact",
    slug: "contact-libre",
  })
  await t.run((ctx) => ctx.db.patch(id, { slug: "contact" }))

  // Le fichier tire son chemin de lui-même : renommer la ligne sans
  // renommer le fichier rendait la page inatteignable, en silence. Le
  // refus dit quel fichier renommer.
  await expect(
    owner.identity.mutation(api.pages.update, { id, slug: "contact-v2" }),
  ).rejects.toMatchObject({
    data: { code: "SLUG_FIXED_BY_ROUTE", file: "src/pages/contact.astro" },
  })
})

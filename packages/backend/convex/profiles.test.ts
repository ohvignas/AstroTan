import { convexTest, type TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import betterAuthSchema from "./betterAuth/schema"
import { components, internal, api } from "./_generated/api"
import {
  ORIGIN,
  modules,
  betterAuthModules,
  seedUser,
  signIn,
  identityFor,
} from "./testing/betterAuthFixture"

// Fixture partagée avec `lib/authz.test.ts` — voir
// `convex/testing/betterAuthFixture.ts` pour `seedUser`/`signIn`/
// `identityFor` et pourquoi ils vivent là plutôt que d'être dupliqués ici
// (comme avant ce fix round) ou dans chaque fichier qui en a besoin.
// `makeTestConvex` reste défini ici (et dans `authz.test.ts`, à
// l'identique) : il a besoin de la *valeur* `convexTest`, que le fixture
// partagé n'importe délibérément pas (voir son en-tête) puisque `convex/`
// est balayé et bundlé par le vrai déploiement Convex.
//
// Reprend le principe de `auth.ownerInvariant.test.ts` (Task 6) : drive
// les vraies mutations Better Auth (`auth.api.createUser`,
// `/admin/update-user`, `/admin/remove-user`, …), jamais un appel direct
// au corps d'un trigger, pour prouver que le composant *appelle
// réellement* `onCreate`/`onUpdate`/`onDelete` — un test qui invoque
// directement la fonction exportée par `auth.ts` ne prouve que le corps
// de la fonction, jamais le câblage `triggers`/`authFunctions` qui la
// relie au composant. Les deux tests de rejeu (I3 plus bas) sont
// l'exception délibérée : ils invoquent `internal.auth.onCreate`/
// `onDelete` directement, parce que ce qu'ils prouvent — l'idempotence du
// *corps* du trigger sous rejeu — est une propriété de ce corps, pas du
// câblage, et le câblage lui-même est déjà prouvé ailleurs dans ce
// fichier sans jamais appeler un trigger à la main.

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
})

afterEach(() => {
  process.env = originalEnv
})

function makeTestConvex(): TestConvex<typeof schema> {
  const t = convexTest(schema, modules)
  t.registerComponent("betterAuth", betterAuthSchema, betterAuthModules)
  return t
}

async function getProfile(t: TestConvex<typeof schema>, authUserId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query("profiles")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", authUserId))
      .unique(),
  )
}

// --- Step 1 du brief : `ensure` en isolation, sans le composant --------

test("créer un utilisateur Better Auth crée un profil sans rôle", async () => {
  const t = convexTest(schema, modules)
  await t.mutation(internal.profiles.ensure, { authUserId: "u_1", displayName: "Flo" })
  const profile = await t.run(async (ctx) =>
    ctx.db
      .query("profiles")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", "u_1"))
      .unique(),
  )
  expect(profile?.displayName).toBe("Flo")
  expect(profile).not.toHaveProperty("role")
})

test("ensure est idempotent", async () => {
  const t = convexTest(schema, modules)
  await t.mutation(internal.profiles.ensure, { authUserId: "u_1", displayName: "Flo" })
  await t.mutation(internal.profiles.ensure, { authUserId: "u_1", displayName: "Flo" })
  const all = await t.run(async (ctx) => ctx.db.query("profiles").collect())
  expect(all).toHaveLength(1)
})

// --- Le trigger réel : preuve que Better Auth appelle onCreate ---------

test("créer un utilisateur via le composant Better Auth (chemin réel) crée son profil, sans rôle", async () => {
  const t = makeTestConvex()
  const user = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })

  const profile = await getProfile(t, user.id)
  expect(profile?.displayName).toBe("Flo")
  expect(profile).not.toHaveProperty("role")
})

// Preuve des DEUX liaisons : `by_auth_user` (application -> composant) ET
// `setUserId` (composant -> application). Une seule des deux prouvée ne
// suffit pas — c'est exactement le genre de trou qu'une tâche précédente a
// laissé passer en ne vérifiant qu'une liste de fichiers.
test("onCreate pose les deux liaisons : by_auth_user ET setUserId (chemin réel)", async () => {
  const t = makeTestConvex()
  const user = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })
  const profile = await getProfile(t, user.id)
  expect(profile).not.toBeNull()

  const componentUser = await t.run(async (ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "_id", value: user.id }],
    }),
  )
  expect((componentUser as { userId?: string } | null)?.userId).toBe(profile?._id)
})

// Rejeu du hook : `ensure` doit rester idempotent même appelé après le
// vrai chemin composant, pas seulement quand on l'appelle deux fois de
// suite en isolation (ce que "ensure est idempotent" ci-dessus couvre
// déjà séparément).
test("un utilisateur Better Auth ne produit jamais deux profils, même si ensure est rejoué (chemin réel + rejeu)", async () => {
  const t = makeTestConvex()
  const user = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })
  await t.mutation(internal.profiles.ensure, { authUserId: user.id, displayName: "Flo" })
  const all = await t.run(async (ctx) => ctx.db.query("profiles").collect())
  expect(all).toHaveLength(1)
})

// I3 : `onCreate` lui-même (pas seulement `ensure` appelée à la main) doit
// être idempotent — le brief le dit explicitement, "le hook peut rejouer".
// Invoque `internal.auth.onCreate` directement une seconde fois avec le
// document réel du composant (pas un document synthétique : `setUserId`
// dans `onCreate` a besoin d'une ligne "user" du composant qui existe
// vraiment, sinon le composant lève "Failed to update user"). C'est un
// test légitime du corps du trigger en isolation, distinct de la preuve
// de câblage ci-dessus : celle-ci n'invoque jamais un trigger à la main,
// celui-ci le fait exprès, pour une propriété différente.
test("un rejeu direct de onCreate sur un utilisateur déjà connu ne crée pas de second profil", async () => {
  const t = makeTestConvex()
  const user = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })
  const componentUser = await t.run(async (ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "_id", value: user.id }],
    }),
  )
  await t.mutation(internal.auth.onCreate, { model: "user", doc: componentUser })

  const all = await t.run(async (ctx) =>
    ctx.db
      .query("profiles")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", user.id))
      .collect(),
  )
  expect(all).toHaveLength(1)
})

// --- onUpdate : chemin de réparation, plus de resynchronisation --------

// M3/I2 : `onUpdate` ne recopie plus `user.name` dans `displayName` — une
// fois que l'utilisateur a choisi son nom affiché via `updateMine`, c'est
// son choix, pas celui de Better Auth ; un admin qui renomme quelqu'un ne
// doit pas l'écraser silencieusement.
test("renommer un utilisateur via /admin/update-user ne touche plus displayName (chemin réel)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })
  const ownerCookie = await signIn(t, "flo@example.com", "correct horse battery staple 1")

  const res = await t.fetch("/api/auth/admin/update-user", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: owner.id, data: { name: "Florence" } }),
  })
  expect(res.status).toBe(200)

  const profile = await getProfile(t, owner.id)
  expect(profile?.displayName).toBe("Flo")
})

// Le pendant positif du test précédent : un choix fait via `updateMine`
// survit à un renommage administratif ultérieur — pas seulement "le nom
// Better Auth d'origine n'est pas écrasé", mais "un choix explicite de
// l'utilisateur ne l'est pas non plus".
test("un displayName choisi via updateMine survit à un renommage administratif (chemin réel)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })
  const ownerCookie = await signIn(t, "flo@example.com", "correct horse battery staple 1")
  const identity = await identityFor(t, owner.id)
  await identity.mutation(api.profiles.updateMine, { displayName: "Choix de Flo" })

  const res = await t.fetch("/api/auth/admin/update-user", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: owner.id, data: { name: "Florence" } }),
  })
  expect(res.status).toBe(200)

  const profile = await getProfile(t, owner.id)
  expect(profile?.displayName).toBe("Choix de Flo")
})

test("bannir un utilisateur via /admin/ban-user laisse son profil intact (chemin réel)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })
  const editor = await seedUser(t, {
    email: "editor@example.com",
    password: "correct horse battery staple 2",
    name: "Editor",
    role: "editor",
  })
  const ownerCookie = await signIn(t, "flo@example.com", "correct horse battery staple 1")

  const res = await t.fetch("/api/auth/admin/ban-user", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: editor.id }),
  })
  expect(res.status).toBe(200)

  const profile = await getProfile(t, editor.id)
  expect(profile?.displayName).toBe("Editor")
})

// I2 : `onUpdate` est désormais le chemin de réparation — il recrée un
// profil manquant à la prochaine écriture Better Auth sur cet utilisateur,
// plutôt que de rester silencieux (`if (!profile) return`, avant ce fix).
// Simule l'invariant rompu en supprimant la ligne `profiles` directement
// (sans passer par `onDelete`), puis déclenche n'importe quelle écriture
// admin sur ce même utilisateur.
test("onUpdate recrée un profil manquant (chemin de réparation, chemin réel)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })
  const ownerCookie = await signIn(t, "flo@example.com", "correct horse battery staple 1")

  const before = await getProfile(t, owner.id)
  expect(before).not.toBeNull()
  await t.run(async (ctx) => ctx.db.delete(before!._id))
  expect(await getProfile(t, owner.id)).toBeNull()

  const res = await t.fetch("/api/auth/admin/update-user", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: owner.id, data: { name: "Florence" } }),
  })
  expect(res.status).toBe(200)

  const repaired = await getProfile(t, owner.id)
  expect(repaired).not.toBeNull()
  expect(repaired?.displayName).toBe("Florence")

  // La réparation pose aussi `setUserId`, exactement comme `onCreate` —
  // sinon la liaison composant -> application resterait cassée après une
  // réparation qui ne répare qu'à moitié.
  const componentUser = await t.run(async (ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "_id", value: owner.id }],
    }),
  )
  expect((componentUser as { userId?: string } | null)?.userId).toBe(repaired?._id)
})

// --- onDelete : le profil ne survit jamais à son utilisateur -----------

test("supprimer un utilisateur via /admin/remove-user supprime son profil (chemin réel)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })
  const editor = await seedUser(t, {
    email: "editor@example.com",
    password: "correct horse battery staple 2",
    name: "Editor",
    role: "editor",
  })
  const ownerCookie = await signIn(t, "flo@example.com", "correct horse battery staple 1")

  expect(await getProfile(t, editor.id)).not.toBeNull()

  const res = await t.fetch("/api/auth/admin/remove-user", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: editor.id }),
  })
  expect(res.status).toBe(200)

  expect(await getProfile(t, editor.id)).toBeNull()
})

// M7 : `onDelete` ne doit pas lever si le profil est déjà absent (rejeu du
// hook, ou utilisateur dont le profil n'a jamais existé) — le comportement
// était déjà correct (`if (profile) await ctx.db.delete(...)`), mais
// rien ne le vérifiait.
test("onDelete ne lève pas si le profil est déjà absent (idempotence de la suppression)", async () => {
  const t = convexTest(schema, modules)
  const now = Date.now()
  await expect(
    t.mutation(internal.auth.onDelete, {
      model: "user",
      doc: {
        _id: "u_never_had_a_profile",
        _creationTime: now,
        name: "Ghost",
        email: "ghost@example.com",
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      },
    }),
  ).resolves.not.toThrow()
})

// --- profiles.me : recompose le rôle à la lecture -----------------------

test("profiles.me renvoie le rôle et l'email composés depuis Better Auth, jamais stockés sur le profil (chemin réel)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })
  await signIn(t, "flo@example.com", "correct horse battery staple 1")
  const identity = await identityFor(t, owner.id)

  const me = await identity.query(api.profiles.me, {})
  expect(me.role).toBe("owner")
  expect(me.email).toBe("flo@example.com")
  expect(me.displayName).toBe("Flo")

  const stored = await getProfile(t, owner.id)
  expect(stored).not.toHaveProperty("role")
})

test("profiles.me refuse un appel non authentifié", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.profiles.me, {})).rejects.toMatchObject({
    data: { code: "UNAUTHENTICATED" },
  })
})

// I1 : `{ ...profile, role, email }` avec `profile === null` vaut
// `{ role, email }` — JS étale `null` silencieusement en objet vide — donc
// sans garde explicite, un utilisateur dont le profil manque recevait un
// 200 qui rapporte l'invariant "un profil par utilisateur" comme respecté
// alors qu'il ne l'est pas. Supprime le profil directement (sans passer
// par `onDelete`) pour simuler l'invariant rompu sans qu'aucune écriture
// Better Auth n'ait eu la chance de le réparer via `onUpdate` entre temps.
test("profiles.me lève NOT_FOUND plutôt que de renvoyer un profil partiel quand le profil manque", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })
  await signIn(t, "flo@example.com", "correct horse battery staple 1")
  const identity = await identityFor(t, owner.id)

  const profile = await getProfile(t, owner.id)
  await t.run(async (ctx) => ctx.db.delete(profile!._id))

  await expect(identity.query(api.profiles.me, {})).rejects.toMatchObject({
    data: { code: "NOT_FOUND" },
  })
})

// --- profiles.updateMine : les trois rôles, mais seulement sur soi -----

for (const role of ["owner", "admin", "editor"] as const) {
  test(`profiles.updateMine — ${role} peut modifier son propre profil (chemin réel)`, async () => {
    const t = makeTestConvex()
    // Un `owner` doit exister avant tout `admin`/`editor` pour que le
    // bootstrap de l'invariant single-owner (Task 6) n'interfère pas ;
    // pour le cas `role === "owner"` c'est ce même utilisateur qui sert
    // de sujet du test.
    const ownerEmail = "owner@example.com"
    const ownerPassword = "correct horse battery staple 1"
    const owner = await seedUser(t, {
      email: ownerEmail,
      password: ownerPassword,
      name: "Owner",
      role: "owner",
    })
    const subjectEmail = role === "owner" ? ownerEmail : `${role}@example.com`
    const subjectPassword = role === "owner" ? ownerPassword : "correct horse battery staple 2"
    const subject =
      role === "owner"
        ? owner
        : await seedUser(t, {
            email: subjectEmail,
            password: subjectPassword,
            name: role === "admin" ? "Admin" : "Editor",
            role,
          })
    await signIn(t, subjectEmail, subjectPassword)
    const identity = await identityFor(t, subject.id)

    await identity.mutation(api.profiles.updateMine, { displayName: "Nouveau nom" })

    const profile = await getProfile(t, subject.id)
    expect(profile?.displayName).toBe("Nouveau nom")
  })
}

// La propriété centrale de cette tâche : `updateMine` ne prend aucun id de
// profil ou d'utilisateur cible en argument, donc rien ne permet à un
// appelant — même owner ou admin — de modifier le profil de quelqu'un
// d'autre à travers cette mutation. Vérifié en observant l'état final des
// DEUX profils, pas seulement l'absence d'erreur.
test("profiles.updateMine ne touche jamais qu'au profil de l'appelant, jamais à celui d'un autre utilisateur (chemin réel)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "owner@example.com",
    password: "correct horse battery staple 1",
    name: "Owner",
    role: "owner",
  })
  const editor = await seedUser(t, {
    email: "editor@example.com",
    password: "correct horse battery staple 2",
    name: "Editor",
    role: "editor",
  })
  await signIn(t, "owner@example.com", "correct horse battery staple 1")
  const ownerIdentity = await identityFor(t, owner.id)

  await ownerIdentity.mutation(api.profiles.updateMine, { displayName: "Owner Renamed" })

  const ownerProfile = await getProfile(t, owner.id)
  const editorProfile = await getProfile(t, editor.id)
  expect(ownerProfile?.displayName).toBe("Owner Renamed")
  expect(editorProfile?.displayName).toBe("Editor")
})

test("profiles.updateMine refuse un appel non authentifié", async () => {
  const t = makeTestConvex()
  await expect(
    t.mutation(api.profiles.updateMine, { displayName: "x" }),
  ).rejects.toMatchObject({
    data: { code: "UNAUTHENTICATED" },
  })
})

// M2 : `displayName` n'est ni illimité ni brut — vide après trim, ou plus
// de 100 caractères, est refusé ; les espaces superflus sont retirés.
test("profiles.updateMine refuse un displayName vide après trim", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })
  await signIn(t, "flo@example.com", "correct horse battery staple 1")
  const identity = await identityFor(t, owner.id)

  await expect(
    identity.mutation(api.profiles.updateMine, { displayName: "   " }),
  ).rejects.toMatchObject({ data: { code: "INVALID_DISPLAY_NAME" } })

  const profile = await getProfile(t, owner.id)
  expect(profile?.displayName).toBe("Flo")
})

test("profiles.updateMine refuse un displayName de plus de 100 caractères", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })
  await signIn(t, "flo@example.com", "correct horse battery staple 1")
  const identity = await identityFor(t, owner.id)

  await expect(
    identity.mutation(api.profiles.updateMine, { displayName: "x".repeat(101) }),
  ).rejects.toMatchObject({ data: { code: "INVALID_DISPLAY_NAME" } })
})

test("profiles.updateMine retire les espaces superflus d'un displayName valide", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })
  await signIn(t, "flo@example.com", "correct horse battery staple 1")
  const identity = await identityFor(t, owner.id)

  await identity.mutation(api.profiles.updateMine, { displayName: "  Florence  " })

  const profile = await getProfile(t, owner.id)
  expect(profile?.displayName).toBe("Florence")
})

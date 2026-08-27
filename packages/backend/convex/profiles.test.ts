import { convexTest, type TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import betterAuthSchema from "./betterAuth/schema"
import { createAuth } from "./auth"
import { components, internal, api } from "./_generated/api"

// Fixture reprise telle quelle de `auth.ownerInvariant.test.ts` (Task 6) :
// enregistre le composant `betterAuth` avec le schéma de *ce* Local
// Install (pas le schéma par défaut du paquet) et drive les vraies
// mutations Better Auth (`auth.api.createUser`, `/admin/update-user`,
// `/admin/remove-user`), pas un appel direct au corps du trigger. C'est
// la seule façon de prouver que le composant *appelle réellement*
// `onCreate`/`onUpdate`/`onDelete` — un test qui invoque directement la
// fonction exportée par `auth.ts` ne prouve que le corps de la fonction,
// jamais le câblage `triggers`/`authFunctions` qui la relie au composant.
const modules = import.meta.glob("./**/*.ts")
const betterAuthModules = import.meta.glob("./betterAuth/**/*.ts")

const ORIGIN = "http://localhost:3000"

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

// Seeding server-side (pas de `headers`/`request`), comme dans
// `auth.ownerInvariant.test.ts` : c'est l'échappatoire de bootstrap
// documentée du plugin admin, pas un contournement de ce test.
async function seedUser(
  t: TestConvex<typeof schema>,
  user: { email: string; password: string; name: string; role: "owner" | "admin" | "editor" },
) {
  const result = await t.run(async (ctx) => {
    const auth = createAuth(ctx)
    return auth.api.createUser({ body: user })
  })
  return (result as { user: { id: string; role: string } }).user
}

async function signIn(t: TestConvex<typeof schema>, email: string, password: string) {
  const res = await t.fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  })
  expect(res.status).toBe(200)
  const setCookies: string[] = res.headers.getSetCookie()
  const sessionCookie = setCookies
    .map((c) => c.split(";")[0] ?? "")
    .find((c) => c.startsWith("better-auth.session_token="))
  if (!sessionCookie) throw new Error("sign-in did not set a session cookie")
  return sessionCookie
}

async function getProfile(t: TestConvex<typeof schema>, authUserId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query("profiles")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", authUserId))
      .unique(),
  )
}

// Construit une identité Convex de test qui correspond à une *vraie*
// session Better Auth : `authComponent.safeGetAuthUser` (donc
// `requireRole`, donc `profiles.me`/`profiles.updateMine`) lit
// `identity.subject` comme l'id utilisateur Better Auth et
// `identity.sessionId` comme l'`_id` du document `session` du composant —
// vérifié dans `@convex-dev/better-auth@0.12.5`'s
// `src/client/create-client.ts` (`safeGetAuthUser`) et
// `src/plugins/convex/index.ts` (`definePayload` pose `sessionId:
// session.id`, où `session.id` est l'`_id` Convex de la session, mappé par
// l'adaptateur). Une identité Convex "nue" (`t.withIdentity({subject:
// ...})`, sans session réelle derrière) ne peut pas exercer ce chemin —
// c'est pour ça que ce fichier construit une session pour de vrai plutôt
// que de fabriquer ces deux champs.
async function identityFor(t: TestConvex<typeof schema>, userId: string) {
  const sessionDoc = await t.run(async (ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "session",
      where: [{ field: "userId", operator: "eq", value: userId }],
    }),
  )
  const sessionId = (sessionDoc as { _id?: string; id?: string } | null)?._id
  if (!sessionId) throw new Error("no session found for user " + userId)
  return t.withIdentity({ subject: userId, sessionId })
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

// Preuve des DEUX liaisons (M2 du brief) : `by_auth_user` (application ->
// composant) ET `setUserId` (composant -> application). Une seule des deux
// prouvée ne suffit pas — c'est exactement le genre de trou qu'une tâche
// précédente a laissé passer en ne vérifiant qu'une liste de fichiers.
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

// Rejeu du hook : `onCreate` doit rester idempotent même quand il est
// atteint par le vrai chemin composant, pas seulement quand `ensure` est
// appelé deux fois à la main (ce que le test "ensure est idempotent"
// ci-dessus couvre déjà séparément).
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

// --- onUpdate : le profil suit son utilisateur --------------------------

test("renommer un utilisateur via /admin/update-user resynchronise displayName (chemin réel)", async () => {
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
  expect(profile?.displayName).toBe("Florence")
})

// Une mise à jour Better Auth sans rapport avec le nom (ici : un ban) ne
// doit pas être ignorée par le trigger au point de faire échouer
// silencieusement — mais ne doit pas non plus réécrire `displayName`
// inutilement. On vérifie surtout que le profil survit intact.
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

// --- profiles.me : recompose le rôle à la lecture -----------------------

test("profiles.me renvoie le rôle et l'email composés depuis Better Auth, jamais stockés sur le profil (chemin réel)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "flo@example.com",
    password: "correct horse battery staple 1",
    name: "Flo",
    role: "owner",
  })
  const ownerCookie = await signIn(t, "flo@example.com", "correct horse battery staple 1")
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
    const cookie = await signIn(t, subjectEmail, subjectPassword)
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
  const ownerCookie = await signIn(t, "owner@example.com", "correct horse battery staple 1")
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

import { afterEach, beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import { ORIGIN, identityFor, makeTestConvex, seedUser, signIn } from "../testing/betterAuthFixture"

// Drives `users.list`/`setRole`/`remove` — the screen behind Task 10. Like
// `invitations.test.ts`, every test here goes through a *real* Better Auth
// session (`seedUser` + `signIn` + `identityFor`), never a bare
// `t.withIdentity({subject: ...})`: `requireRole` needs the registered
// `betterAuth` component and a real session document to resolve at all, and
// `setRole`/`remove` go one step further — they call
// `authComponent.getAuth(createAuth, ctx)` to forward the *caller's own*
// session as a bearer header into `auth.api.setRole`/`auth.api.removeUser`,
// so that better-auth's own RBAC permission check and
// `databaseHooks.user.update/delete.before` (Task 6's real barrier) both run
// for real, not just our own `assertOwnerInvariant` pre-check.

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
})

afterEach(() => {
  process.env = originalEnv
})

async function seedActor(
  t: ReturnType<typeof makeTestConvex>,
  role: "owner" | "admin" | "editor",
  email: string,
  password: string,
  name: string,
) {
  const user = await seedUser(t, { email, password, name, role })
  await signIn(t, email, password)
  const identity = await identityFor(t, user.id)
  return { user, identity }
}

// --- list ------------------------------------------------------------------

test("un editor ne peut pas lister les utilisateurs", async () => {
  const t = makeTestConvex()
  const { identity: asEditor } = await seedActor(
    t,
    "editor",
    "editor@example.com",
    "correct horse battery staple 1",
    "Editor",
  )

  await expect(asEditor.query(api.users.list, {})).rejects.toThrow(/FORBIDDEN/)
})

test("list refuse un appel non authentifié", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.users.list, {})).rejects.toMatchObject({
    data: { code: "UNAUTHENTICATED" },
  })
})

test("list renvoie les trois utilisateurs avec leur rôle et leur displayName, jamais de champ sensible", async () => {
  const t = makeTestConvex()
  const { identity: asOwner } = await seedActor(
    t,
    "owner",
    "owner@example.com",
    "correct horse battery staple 2",
    "Owner Person",
  )
  await seedActor(t, "admin", "admin@example.com", "correct horse battery staple 3", "Admin Person")
  await seedActor(t, "editor", "editor@example.com", "correct horse battery staple 4", "Editor Person")

  const rows = await asOwner.query(api.users.list, {})
  expect(rows).toHaveLength(3)

  const byEmail = new Map(rows.map((r) => [r.email, r]))
  expect(byEmail.get("owner@example.com")).toMatchObject({
    role: "owner",
    displayName: "Owner Person",
  })
  expect(byEmail.get("admin@example.com")).toMatchObject({
    role: "admin",
    displayName: "Admin Person",
  })
  expect(byEmail.get("editor@example.com")).toMatchObject({
    role: "editor",
    displayName: "Editor Person",
  })

  for (const row of rows) {
    expect(row).not.toHaveProperty("tokenHash")
    expect(row).not.toHaveProperty("banReason")
    expect(typeof row.id).toBe("string")
  }
})

// --- setRole -----------------------------------------------------------------

test("un admin ne peut pas changer le rôle d'un owner", async () => {
  const t = makeTestConvex()
  const { user: owner } = await seedActor(
    t,
    "owner",
    "owner@example.com",
    "correct horse battery staple 5",
    "Owner",
  )
  const { identity: asAdmin } = await seedActor(
    t,
    "admin",
    "admin@example.com",
    "correct horse battery staple 6",
    "Admin",
  )

  await expect(
    asAdmin.mutation(api.users.setRole, { userId: owner.id, role: "editor" }),
  ).rejects.toThrow(/FORBIDDEN/)
})

test("un editor ne peut pas changer le rôle de qui que ce soit", async () => {
  const t = makeTestConvex()
  const { user: target } = await seedActor(
    t,
    "admin",
    "target@example.com",
    "correct horse battery staple 7",
    "Target",
  )
  const { identity: asEditor } = await seedActor(
    t,
    "editor",
    "editor@example.com",
    "correct horse battery staple 8",
    "Editor",
  )

  await expect(
    asEditor.mutation(api.users.setRole, { userId: target.id, role: "editor" }),
  ).rejects.toThrow(/FORBIDDEN/)
})

test("un owner promeut légitimement un editor en admin (chemin réel : RBAC + databaseHooks)", async () => {
  const t = makeTestConvex()
  const { identity: asOwner } = await seedActor(
    t,
    "owner",
    "owner@example.com",
    "correct horse battery staple 9",
    "Owner",
  )
  const { user: editor } = await seedActor(
    t,
    "editor",
    "editor@example.com",
    "correct horse battery staple 10",
    "Editor",
  )

  await asOwner.mutation(api.users.setRole, { userId: editor.id, role: "admin" })

  const rows = await asOwner.query(api.users.list, {})
  expect(rows.find((r) => r.email === "editor@example.com")?.role).toBe("admin")
})

test("setRole refuse de rétrograder le dernier owner (LAST_OWNER)", async () => {
  const t = makeTestConvex()
  const { user: owner, identity: asOwner } = await seedActor(
    t,
    "owner",
    "owner@example.com",
    "correct horse battery staple 11",
    "Owner",
  )

  await expect(
    asOwner.mutation(api.users.setRole, { userId: owner.id, role: "admin" }),
  ).rejects.toThrow(/LAST_OWNER/)
})

test("setRole refuse de fabriquer un second owner (OWNER_ALREADY_EXISTS)", async () => {
  const t = makeTestConvex()
  const { identity: asOwner } = await seedActor(
    t,
    "owner",
    "owner@example.com",
    "correct horse battery staple 12",
    "Owner",
  )
  const { user: editor } = await seedActor(
    t,
    "editor",
    "editor@example.com",
    "correct horse battery staple 13",
    "Editor",
  )

  await expect(
    asOwner.mutation(api.users.setRole, { userId: editor.id, role: "owner" }),
  ).rejects.toThrow(/OWNER_ALREADY_EXISTS/)
})

test("setRole refuse une cible inconnue (NOT_FOUND)", async () => {
  const t = makeTestConvex()
  const { identity: asOwner } = await seedActor(
    t,
    "owner",
    "owner@example.com",
    "correct horse battery staple 14",
    "Owner",
  )

  await expect(
    asOwner.mutation(api.users.setRole, { userId: "does-not-exist", role: "editor" }),
  ).rejects.toThrow(/NOT_FOUND/)
})

// --- remove ------------------------------------------------------------------

test("un owner retire légitimement un editor (chemin réel : RBAC + databaseHooks)", async () => {
  const t = makeTestConvex()
  const { identity: asOwner } = await seedActor(
    t,
    "owner",
    "owner@example.com",
    "correct horse battery staple 15",
    "Owner",
  )
  const { user: editor } = await seedActor(
    t,
    "editor",
    "editor@example.com",
    "correct horse battery staple 16",
    "Editor",
  )

  await asOwner.mutation(api.users.remove, { userId: editor.id })

  const rows = await asOwner.query(api.users.list, {})
  expect(rows.find((r) => r.email === "editor@example.com")).toBeUndefined()
})

test("un admin ne peut pas retirer un owner", async () => {
  const t = makeTestConvex()
  const { user: owner } = await seedActor(
    t,
    "owner",
    "owner@example.com",
    "correct horse battery staple 17",
    "Owner",
  )
  const { identity: asAdmin } = await seedActor(
    t,
    "admin",
    "admin@example.com",
    "correct horse battery staple 18",
    "Admin",
  )

  await expect(asAdmin.mutation(api.users.remove, { userId: owner.id })).rejects.toThrow(
    /FORBIDDEN/,
  )
})

test("un editor ne peut retirer personne", async () => {
  const t = makeTestConvex()
  const { user: target } = await seedActor(
    t,
    "admin",
    "target@example.com",
    "correct horse battery staple 19",
    "Target",
  )
  const { identity: asEditor } = await seedActor(
    t,
    "editor",
    "editor@example.com",
    "correct horse battery staple 20",
    "Editor",
  )

  await expect(asEditor.mutation(api.users.remove, { userId: target.id })).rejects.toThrow(
    /FORBIDDEN/,
  )
})

test("un owner ne peut pas se retirer lui-même (CANNOT_REMOVE_SELF)", async () => {
  const t = makeTestConvex()
  const { user: owner, identity: asOwner } = await seedActor(
    t,
    "owner",
    "owner@example.com",
    "correct horse battery staple 21",
    "Owner",
  )

  await expect(asOwner.mutation(api.users.remove, { userId: owner.id })).rejects.toThrow(
    /CANNOT_REMOVE_SELF/,
  )
})

test("remove refuse une cible inconnue (NOT_FOUND)", async () => {
  const t = makeTestConvex()
  const { identity: asOwner } = await seedActor(
    t,
    "owner",
    "owner@example.com",
    "correct horse battery staple 22",
    "Owner",
  )

  await expect(
    asOwner.mutation(api.users.remove, { userId: "does-not-exist" }),
  ).rejects.toThrow(/NOT_FOUND/)
})

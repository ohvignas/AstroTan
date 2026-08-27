import { afterEach, beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import { generateToken, hashToken } from "./lib/token"
import { ORIGIN, identityFor, makeTestConvex, seedUser, signIn } from "../testing/betterAuthFixture"

// This suite drives `invitations.create`/`accept`/`revoke` — the *only*
// way an account can come into existence in this system (see the task
// brief's stated invariant). `create` is gated by `requireRole`, which
// needs a *real* Better Auth session behind the caller (not a bare
// `t.withIdentity({subject: ...})`) — see `authz.test.ts`'s header for why
// a bare identity fails with "Component betterAuth is not registered"
// rather than a meaningful FORBIDDEN/success. `accept` goes one step
// further: it calls `createAuth(ctx).api.createUser(...)` itself, which
// needs the component registered regardless of who (if anyone) is calling
// it. So every test here uses `makeTestConvex()` + `seedUser`/`signIn`/
// `identityFor` (the shared fixture, `packages/backend/testing/
// betterAuthFixture.ts`), never the brief's illustrative
// `t.withIdentity({subject: "u_admin"})` shortcut, which doesn't exercise
// a real session at all.

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
})

afterEach(() => {
  process.env = originalEnv
})

async function seedAdmin(t: ReturnType<typeof makeTestConvex>) {
  const admin = await seedUser(t, {
    email: "admin@example.com",
    password: "correct horse battery staple 1",
    name: "Admin",
    role: "admin",
  })
  await signIn(t, "admin@example.com", "correct horse battery staple 1")
  return identityFor(t, admin.id)
}

// --- Step 1 du brief : seul le hash du token est stocké -----------------

test("seul le hash du token est stocké", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)

  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  const row = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(row?.tokenHash).not.toBe(token)
  expect(row).not.toHaveProperty("token")
  // Pin the actual hashing scheme, not just "some transformation happened":
  // `accept` re-derives this same hash from the plaintext token to look the
  // row up, so if the two ever drifted apart (different algorithm, wrong
  // input), every invitation would silently become unacceptable.
  expect(row?.tokenHash).toBe(await hashToken(token))
})

// --- Step 2/3 du brief : expiration et non-rejouabilité ------------------

test("une invitation expirée est refusée", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })
  await t.run(async (ctx) => {
    const row = await ctx.db.query("invitations").first()
    await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1000 })
  })

  await expect(
    t.mutation(api.invitations.accept, { token, password: "correct horse battery staple 2" }),
  ).rejects.toThrow(/EXPIRED/)
})

test("une invitation ne peut être consommée deux fois", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  await t.mutation(api.invitations.accept, {
    token,
    password: "correct horse battery staple 2",
  })
  await expect(
    t.mutation(api.invitations.accept, { token, password: "correct horse battery staple 2" }),
  ).rejects.toThrow(/ALREADY_ACCEPTED/)
})

// Ruling 2: ALREADY_ACCEPTED is checked before EXPIRED. Neither of the two
// tests above actually proves the *ordering* — one is expired-but-never-
// accepted, the other is accepted-but-never-expired. This is the case that
// distinguishes them: accept once (consuming it), then let it expire, then
// accept again. A version that checked EXPIRED first would report the
// wrong reason here and make this exact scenario unstable, per the brief.
test("une invitation consommée puis expirée reste ALREADY_ACCEPTED, jamais EXPIRED", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  await t.mutation(api.invitations.accept, {
    token,
    password: "correct horse battery staple 2",
  })
  await t.run(async (ctx) => {
    const row = await ctx.db.query("invitations").first()
    await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1000 })
  })

  await expect(
    t.mutation(api.invitations.accept, { token, password: "correct horse battery staple 2" }),
  ).rejects.toThrow(/ALREADY_ACCEPTED/)
})

// --- Step 4 du brief : un editor ne peut pas inviter ----------------------

test("un editor ne peut pas inviter", async () => {
  const t = makeTestConvex()
  const editor = await seedUser(t, {
    email: "editor@example.com",
    password: "correct horse battery staple 3",
    name: "Editor",
    role: "editor",
  })
  await signIn(t, "editor@example.com", "correct horse battery staple 3")
  const asEditor = await identityFor(t, editor.id)

  await expect(
    asEditor.mutation(api.invitations.create, { email: "invitee@example.com", role: "editor" }),
  ).rejects.toThrow(/FORBIDDEN/)
})

// --- Step 5 du brief : un admin ne peut pas inviter un owner --------------

test("un admin ne peut pas inviter un owner", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)

  await expect(
    asAdmin.mutation(api.invitations.create, { email: "invitee@example.com", role: "owner" }),
  ).rejects.toThrow(/FORBIDDEN/)

  // Not just a thrown error: no invitation row was left behind either.
  const rows = await t.run(async (ctx) => ctx.db.query("invitations").collect())
  expect(rows).toHaveLength(0)
})

// The brief's sample code blocks `role: "owner"` unconditionally in
// `create`, not only for an `admin` actor — worth pinning explicitly,
// since ownership is already unique and never legitimately granted by
// invitation (the owner is bootstrapped out of band). An owner inviting a
// second owner must fail here too, not only at the deeper databaseHooks
// layer.
test("un owner ne peut pas non plus inviter un owner", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "owner@example.com",
    password: "correct horse battery staple 4",
    name: "Owner",
    role: "owner",
  })
  await signIn(t, "owner@example.com", "correct horse battery staple 4")
  const asOwner = await identityFor(t, owner.id)

  await expect(
    asOwner.mutation(api.invitations.create, { email: "invitee@example.com", role: "owner" }),
  ).rejects.toThrow(/FORBIDDEN/)
})

// --- Le deuxième verrou : même une invitation "owner" fabriquée hors de --
// --- `create` échoue à la création du compte (databaseHooks, Task 6) -----

// `create` already refuses to *issue* an owner invitation. This proves the
// second, independent barrier: an invitation row that somehow carries
// `role: "owner"` anyway (a bug, a migration, a direct write — exactly the
// scenario the brief's ruling 3 calls out) must still fail when accepted,
// once a real owner already exists. Seeded directly via `ctx.db.insert`,
// bypassing `create` entirely, precisely so this doesn't depend on `create`
// being the only way such a row could exist.
test("une invitation 'owner' fabriquée hors de create échoue quand même à l'acceptation", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: "owner@example.com",
    password: "correct horse battery staple 4",
    name: "Owner",
    role: "owner",
  })

  const { token, hash } = await generateToken()
  await t.run(async (ctx) =>
    ctx.db.insert("invitations", {
      email: "rogue-owner@example.com",
      role: "owner",
      tokenHash: hash,
      expiresAt: Date.now() + 1000 * 60 * 60,
      invitedBy: "test-setup",
    }),
  )

  await expect(
    t.mutation(api.invitations.accept, { token, password: "correct horse battery staple 5" }),
  ).rejects.toThrow(/OWNER_ALREADY_EXISTS/)

  // No account was created for that email, and the invitation was never
  // marked accepted — the whole mutation rolled back, not just the part
  // that threw.
  const row = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(row?.acceptedAt).toBeUndefined()
})

// --- L'invariant que Task 3 n'a jamais exercé : `by_token_hash` ----------

// Two invitations exist; accepting the *second* one's token must resolve
// to the second row, not "whichever row `accept` happens to see first". A
// version that dropped the index (or replaced the indexed lookup with an
// unfiltered `.first()`) would either throw ("no such index") or silently
// accept the wrong invitation — either way, this test would catch it,
// which nothing in the Task 3 schema test does.
test("accept sélectionne l'invitation qui correspond au hash du token, pas une autre", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)

  await asAdmin.mutation(api.invitations.create, {
    email: "first@example.com",
    role: "editor",
  })
  const { token: secondToken } = await asAdmin.mutation(api.invitations.create, {
    email: "second@example.com",
    role: "admin",
  })

  const result = await t.mutation(api.invitations.accept, {
    token: secondToken,
    password: "correct horse battery staple 6",
  })
  expect(result).toEqual({ email: "second@example.com", role: "admin" })

  const rows = await t.run(async (ctx) => ctx.db.query("invitations").collect())
  const first = rows.find((r) => r.email === "first@example.com")
  const second = rows.find((r) => r.email === "second@example.com")
  expect(first?.acceptedAt).toBeUndefined()
  expect(second?.acceptedAt).toBeDefined()
})

// --- Un token inconnu ou corrompu ne grante rien --------------------------

test("un token inconnu (jamais émis, ou corrompu) est refusé", async () => {
  const t = makeTestConvex()
  await expect(
    t.mutation(api.invitations.accept, {
      token: "0".repeat(64),
      password: "correct horse battery staple 7",
    }),
  ).rejects.toThrow(/INVALID/)
})

// --- L'acceptation crée un vrai compte Better Auth, avec le bon rôle -----

test("accept crée un compte Better Auth avec le rôle porté par l'invitation, et consomme l'invitation", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "admin",
  })

  const result = await t.mutation(api.invitations.accept, {
    token,
    password: "correct horse battery staple 8",
  })
  expect(result).toEqual({ email: "invitee@example.com", role: "admin" })

  // The account is real and can sign in with the password just set.
  const cookie = await signIn(t, "invitee@example.com", "correct horse battery staple 8")
  expect(typeof cookie).toBe("string")

  // It traversed the profile trigger too (Task 7): a profile exists for
  // the freshly-created account, with the display name defaulted from the
  // invitation's email (no `name` argument was passed to `accept`).
  const profile = await t.run(async (ctx) =>
    ctx.db
      .query("profiles")
      .filter((q) => q.eq(q.field("displayName"), "invitee@example.com"))
      .first(),
  )
  expect(profile).not.toBeNull()

  const row = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(row?.acceptedAt).toBeDefined()
})

// --- Un email déjà utilisé ne peut pas être granté deux fois --------------

// "exactement une fois" — a second invitation to an email that already has
// an account must not silently mint a duplicate. `auth.api.createUser`'s
// own `USER_ALREADY_EXISTS` check is what stops this; this test pins that
// it actually stops it *through this path*, and that the invitation is not
// left looking accepted when the account creation it depended on failed.
test("une invitation vers un email déjà pourvu d'un compte échoue, l'invitation reste non consommée", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token: firstToken } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })
  await t.mutation(api.invitations.accept, {
    token: firstToken,
    password: "correct horse battery staple 9",
  })

  const { token: secondToken } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "admin",
  })

  await expect(
    t.mutation(api.invitations.accept, {
      token: secondToken,
      password: "correct horse battery staple 10",
    }),
  ).rejects.toThrow()

  const rows = await t.run(async (ctx) => ctx.db.query("invitations").collect())
  const second = rows.find((r) => r.role === "admin")
  expect(second?.acceptedAt).toBeUndefined()
})

// --- L'échec d'envoi de l'email ne doit pas annuler l'invitation ---------

// Ruling 4: the send is scheduled, not inline — so whatever happens inside
// it (missing RESEND_API_KEY here, since these tests never set one; a
// Resend outage in real life) must never roll back the invitation itself.
// `finishInProgressScheduledFunctions` explicitly tolerates the scheduled
// function failing (see its doc comment in convex-test) — the point of
// this test is that its failure never reaches the caller of `create`, and
// the token it returned is still good afterward.
test("un échec d'envoi de l'email n'invalide pas l'invitation : le token reste utilisable", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)

  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  // Let the scheduled send run (and fail — no RESEND_API_KEY is set in
  // this test environment) without that failure propagating here.
  await t.finishInProgressScheduledFunctions()

  const result = await t.mutation(api.invitations.accept, {
    token,
    password: "correct horse battery staple 11",
  })
  expect(result).toEqual({ email: "invitee@example.com", role: "editor" })
})

// --- revoke : retirer une invitation avant qu'elle ne soit acceptée ------

test("revoke supprime une invitation en attente, dont le token devient inacceptable", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })
  const invitationId = await t.run(async (ctx) => (await ctx.db.query("invitations").first())!._id)

  await asAdmin.mutation(api.invitations.revoke, { invitationId })

  const rows = await t.run(async (ctx) => ctx.db.query("invitations").collect())
  expect(rows).toHaveLength(0)
  await expect(
    t.mutation(api.invitations.accept, { token, password: "correct horse battery staple 12" }),
  ).rejects.toThrow(/INVALID/)
})

test("revoke refuse une invitation inconnue", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  await asAdmin.mutation(api.invitations.create, { email: "invitee@example.com", role: "editor" })
  const invitationId = await t.run(async (ctx) => (await ctx.db.query("invitations").first())!._id)
  await t.run(async (ctx) => ctx.db.delete(invitationId))

  await expect(asAdmin.mutation(api.invitations.revoke, { invitationId })).rejects.toThrow(
    /NOT_FOUND/,
  )
})

// Revoking a consumed invitation isn't harmless cleanup — it would erase
// the record that this specific invitation is what created the account.
test("revoke refuse une invitation déjà acceptée", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })
  await t.mutation(api.invitations.accept, {
    token,
    password: "correct horse battery staple 13",
  })
  const invitationId = await t.run(async (ctx) => (await ctx.db.query("invitations").first())!._id)

  await expect(asAdmin.mutation(api.invitations.revoke, { invitationId })).rejects.toThrow(
    /ALREADY_ACCEPTED/,
  )

  const row = await t.run(async (ctx) => ctx.db.get(invitationId))
  expect(row).not.toBeNull()
})

test("un editor ne peut pas revoke une invitation", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  await asAdmin.mutation(api.invitations.create, { email: "invitee@example.com", role: "editor" })
  const invitationId = await t.run(async (ctx) => (await ctx.db.query("invitations").first())!._id)

  const editor = await seedUser(t, {
    email: "editor@example.com",
    password: "correct horse battery staple 14",
    name: "Editor",
    role: "editor",
  })
  await signIn(t, "editor@example.com", "correct horse battery staple 14")
  const asEditor = await identityFor(t, editor.id)

  await expect(asEditor.mutation(api.invitations.revoke, { invitationId })).rejects.toThrow(
    /FORBIDDEN/,
  )
  const row = await t.run(async (ctx) => ctx.db.get(invitationId))
  expect(row).not.toBeNull()
})

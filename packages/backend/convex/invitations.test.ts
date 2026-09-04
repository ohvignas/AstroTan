import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { Resend } from "@convex-dev/resend"
import { api, internal } from "./_generated/api"
import { generateToken, hashToken } from "./lib/token"
import { CATALOGUE } from "./lib/catalogueEmails"
import { MAX_DISPLAY_NAME_LENGTH } from "./profiles"
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
  // Les tests du gabarit espionnent `Resend.prototype.sendEmail` : sans
  // cette ligne, l'espion survivrait au test qui l'a posé et le fichier
  // deviendrait sensible à l'ordre d'exécution.
  vi.restoreAllMocks()
})

// `t.finishInProgressScheduledFunctions()` only drains jobs already in the
// "inProgress" state — a `runAfter(0, ...)` job can still be "pending"
// (its backing timer hasn't fired yet) at the moment that's called,
// especially for an *action* like `sendInvitationEmail`, which schedules
// no work of its own for that helper to wait on the way a mutation's
// nested `ctx.runMutation` calls do. Measured directly: two tests written
// with `finishInProgressScheduledFunctions()` here left the job "pending"
// and `pendingToken` unchanged even though the send had genuinely already
// failed by the time the assertion ran — a timing race, not a bug in
// `invitations.ts`. `finishAllScheduledFunctions` with fake timers is the
// combination convex-test's own doc comment recommends for this
// (`vi.useFakeTimers()` only needs to be active for this one call — jobs
// scheduled under real timers are still drained "as long as their
// scheduled time has already passed on the real clock", which
// `runAfter(0, ...)` always satisfies).
async function runScheduledFunctions(t: ReturnType<typeof makeTestConvex>) {
  vi.useFakeTimers()
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers)
  } finally {
    vi.useRealTimers()
  }
}

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

// I1 (Lot 1 final review): several tests below invite an `admin` role
// specifically to prove `accept` preserves *whatever* role the invitation
// carries — that needs an `owner` actor now that `admin` is refused
// `role: "admin"` at `create` (see `invitations.ts`'s own I1 comment).
async function seedOwner(t: ReturnType<typeof makeTestConvex>) {
  const owner = await seedUser(t, {
    email: "owner-issuer@example.com",
    password: "correct horse battery staple owner-issuer",
    name: "Owner Issuer",
    role: "owner",
  })
  await signIn(t, "owner-issuer@example.com", "correct horse battery staple owner-issuer")
  return identityFor(t, owner.id)
}

// --- Step 1 du brief : seul le hash du token est stocké durablement -------

test("le hash durable du token est correct, et ce n'est jamais un champ 'token'", async () => {
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

// Review round 1, I1: the plaintext is genuinely staged in `pendingToken`
// right after `create` — this test says so honestly, rather than the
// previous version's implicit (and, once `pendingToken` existed, false)
// claim that nothing but the hash was ever present. What actually matters
// is bounding *how long* that staging lasts: cleared the moment the
// scheduled send is claimed, regardless of whether the send that follows
// succeeds — proven here by never setting a usable `RESEND_API_KEY`, so
// the send itself fails, and checking the field is gone anyway.
test("le token en clair n'est mis en scène que transitoirement, effacé dès la réclamation programmée même si l'envoi échoue ensuite", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)

  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })
  const justAfterCreate = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(justAfterCreate?.pendingToken).toBe(token)

  await runScheduledFunctions(t)

  const afterScheduledRun = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(afterScheduledRun?.pendingToken).toBeUndefined()
})

// Round 2 (review, item 3): `accept` clears `pendingToken` defensively on
// its own, not only relying on `claimPendingToken` having already done
// it — this is what keeps the field from surviving indefinitely if the
// scheduled action fails *before* its own claim-and-clear mutation call
// returns (Convex doesn't retry scheduled functions). Isolated here by
// accepting *before* the scheduled send ever runs at all — so this proves
// `accept`'s own clear specifically, independent of `claimPendingToken`.
test("accept efface pendingToken lui-même, même avant que l'envoi programmé n'ait tourné", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  const beforeAnythingRuns = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(beforeAnythingRuns?.pendingToken).toBe(token)

  await t.mutation(api.invitations.accept, {
    name: "Invité·e",
    token,
    password: "correct horse battery staple pending1",
  })

  const afterAccept = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(afterAccept?.pendingToken).toBeUndefined()
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
    t.mutation(api.invitations.accept, { name: "Invité·e", token, password: "correct horse battery staple 2" }),
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
    name: "Invité·e",
    token,
    password: "correct horse battery staple 2",
  })
  await expect(
    t.mutation(api.invitations.accept, { name: "Invité·e", token, password: "correct horse battery staple 2" }),
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
    name: "Invité·e",
    token,
    password: "correct horse battery staple 2",
  })
  await t.run(async (ctx) => {
    const row = await ctx.db.query("invitations").first()
    await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1000 })
  })

  await expect(
    t.mutation(api.invitations.accept, { name: "Invité·e", token, password: "correct horse battery staple 2" }),
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

// I1 (Lot 1 final review): spec §5 gives `admin` authority to invite/edit
// `editor` — never another `admin` — reserving `admin` invitations to
// `owner`. Symmetric with `un admin ne peut pas inviter un owner` above,
// which only ever pinned the `owner` case; nothing here exercised `admin`
// in either direction before this fix.
test("I1 : un admin ne peut pas inviter un autre admin", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)

  await expect(
    asAdmin.mutation(api.invitations.create, { email: "invitee@example.com", role: "admin" }),
  ).rejects.toThrow(/FORBIDDEN/)

  const rows = await t.run(async (ctx) => ctx.db.query("invitations").collect())
  expect(rows).toHaveLength(0)
})

test("I1 (contrôle) : un owner peut inviter un admin", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "owner@example.com",
    password: "correct horse battery staple 33",
    name: "Owner",
    role: "owner",
  })
  await signIn(t, "owner@example.com", "correct horse battery staple 33")
  const asOwner = await identityFor(t, owner.id)

  const { token } = await asOwner.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "admin",
  })
  expect(typeof token).toBe("string")

  const rows = await t.run(async (ctx) => ctx.db.query("invitations").collect())
  expect(rows).toHaveLength(1)
  expect(rows[0]?.role).toBe("admin")
})

// --- Round 2 (review, item 5) : l'email est borné dans create -----------

// `accept` used to default `displayName` to `invite.email` when no `name`
// was given, so an unbounded `email` on `create` let a
// syntactically-fine-but-very-long address become a `profiles.displayName`
// past the 100-character limit enforced everywhere else it's set. `name` is
// required now and that fallback is gone, but the bound stays: the email is
// still shown verbatim on the accept-invite page, and an address nobody can
// read is its own defect. Bounded to the same `MAX_DISPLAY_NAME_LENGTH`
// `profiles` already exports and enforces, reused rather than a second
// magic number.
test("create refuse un email de plus de 100 caractères", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const tooLong = `${"x".repeat(MAX_DISPLAY_NAME_LENGTH - 11)}@example.com` // > 100 chars total

  await expect(
    asAdmin.mutation(api.invitations.create, { email: tooLong, role: "editor" }),
  ).rejects.toThrow(/INVALID_EMAIL/)

  const rows = await t.run(async (ctx) => ctx.db.query("invitations").collect())
  expect(rows).toHaveLength(0)
})

test("create refuse un email vide", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)

  await expect(
    asAdmin.mutation(api.invitations.create, { email: "   ", role: "editor" }),
  ).rejects.toThrow(/INVALID_EMAIL/)
})

test("create accepte un email de exactement 100 caractères", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const local = "x".repeat(MAX_DISPLAY_NAME_LENGTH - "@example.com".length)
  const exactly100 = `${local}@example.com`
  expect(exactly100.length).toBe(MAX_DISPLAY_NAME_LENGTH)

  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: exactly100,
    role: "editor",
  })
  expect(typeof token).toBe("string")
})

// Minor (Lot 1 final review): server-side email format validation — until
// now the *only* check was the browser's `type="email"` input, which a
// direct mutation call (this test included) bypasses entirely.
test("create refuse un email de format invalide (pas de @)", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)

  await expect(
    asAdmin.mutation(api.invitations.create, { email: "not-an-email", role: "editor" }),
  ).rejects.toThrow(/INVALID_EMAIL/)

  const rows = await t.run(async (ctx) => ctx.db.query("invitations").collect())
  expect(rows).toHaveLength(0)
})

// Minor (Lot 1 final review): `invitations.by_email` had zero readers, so
// `create` could mint a second, redundant, eventually-unusable invitation
// for an email that already had one still pending.
test("create refuse une deuxième invitation pour un email qui en a déjà une en attente", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)

  await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  await expect(
    asAdmin.mutation(api.invitations.create, {
      email: "invitee@example.com",
      role: "editor",
    }),
  ).rejects.toThrow(/INVITATION_ALREADY_PENDING/)

  const rows = await t.run(async (ctx) => ctx.db.query("invitations").collect())
  expect(rows).toHaveLength(1)
})

// Same index, the other direction: a *revoked* (deleted) or *accepted*
// invitation must not block a fresh one for the same email.
test("create accepte une nouvelle invitation pour un email dont l'invitation précédente a été révoquée", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)

  const { token: firstToken } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })
  const firstRow = await t.run(async (ctx) => ctx.db.query("invitations").first())
  await asAdmin.mutation(api.invitations.revoke, { invitationId: firstRow!._id })

  const { token: secondToken } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })
  expect(secondToken).not.toBe(firstToken)
})

// Minor (Lot 1 final review): the other half of the same index-backed
// check — an email that already has an account must not get a fresh
// (permanently unusable) invitation either, discovered here instead of
// only at `accept` time.
test("create refuse une invitation vers un email qui a déjà un compte", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token: firstToken } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })
  await t.mutation(api.invitations.accept, {
    name: "Invité·e",
    token: firstToken,
    password: "correct horse battery staple by-email",
  })

  await expect(
    asAdmin.mutation(api.invitations.create, {
      email: "invitee@example.com",
      role: "editor",
    }),
  ).rejects.toThrow(/ACCOUNT_ALREADY_EXISTS/)
})

// `create` refuse d'émettre vers un email déjà pris (test ci-dessus), mais
// le compte peut naître ENTRE l'émission et l'acceptation — ou l'invitation
// venir de `bootstrap:createInvitation`, qui est le chemin de l'opérateur.
// Sans traduction, Better Auth remonte alors son `APIError` brut jusque
// dans le formulaire : « User already exists. Use another email. », en
// anglais, sans code, et impossible à expliquer à qui clique sur le lien.
test("accept traduit un compte déjà existant en refus lisible", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "course@example.com",
    role: "editor",
  })

  // Le compte apparaît après l'émission — la course que `create` ne peut
  // pas prévenir.
  await seedUser(t, {
    email: "course@example.com",
    password: "correct horse battery staple course",
    name: "Déjà là",
    role: "editor",
  })

  await expect(
    t.mutation(api.invitations.accept, {
      name: "Invité·e",
      token,
      password: "correct horse battery staple accept",
    }),
  ).rejects.toThrow(/ACCOUNT_ALREADY_EXISTS/)
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
  // A real, currently-valid issuer — not the placeholder `"test-setup"`
  // string this test used before I2 (review round 1): `accept` now
  // re-verifies `invitedBy` against a live Better Auth user, so an
  // unresolvable issuer would throw UNAUTHENTICATED *before* ever reaching
  // the databaseHooks barrier this test exists to prove.
  const issuer = await seedUser(t, {
    email: "issuer-admin@example.com",
    password: "correct horse battery staple 4b",
    name: "Issuer Admin",
    role: "admin",
  })

  const { token, hash } = await generateToken()
  await t.run(async (ctx) =>
    ctx.db.insert("invitations", {
      email: "rogue-owner@example.com",
      role: "owner",
      tokenHash: hash,
      expiresAt: Date.now() + 1000 * 60 * 60,
      invitedBy: issuer.id,
    }),
  )

  await expect(
    t.mutation(api.invitations.accept, { name: "Invité·e", token, password: "correct horse battery staple 5" }),
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
  // I1: an `owner` actor, not `admin` — this test invites `role: "admin"`
  // specifically to prove the *second* invitation (not the first) is the
  // one accepted, and `admin` is refused to an `admin` actor now.
  const asOwner = await seedOwner(t)

  await asOwner.mutation(api.invitations.create, {
    email: "first@example.com",
    role: "editor",
  })
  const { token: secondToken } = await asOwner.mutation(api.invitations.create, {
    email: "second@example.com",
    role: "admin",
  })

  const result = await t.mutation(api.invitations.accept, {
    name: "Invité·e",
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
      name: "Invité·e",
      token: "0".repeat(64),
      password: "correct horse battery staple 7",
    }),
  ).rejects.toThrow(/INVALID/)
})

// --- L'acceptation crée un vrai compte Better Auth, avec le bon rôle -----

test("accept crée un compte Better Auth avec le rôle porté par l'invitation, et consomme l'invitation", async () => {
  const t = makeTestConvex()
  // I1: an `owner` actor — this test invites `role: "admin"` specifically
  // to prove the created account gets that role, and `admin` is refused to
  // an `admin` actor now.
  const asOwner = await seedOwner(t)
  const { token } = await asOwner.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "admin",
  })

  const result = await t.mutation(api.invitations.accept, {
    name: "Invité·e",
    token,
    password: "correct horse battery staple 8",
  })
  expect(result).toEqual({ email: "invitee@example.com", role: "admin" })

  // The account is real and can sign in with the password just set.
  const cookie = await signIn(t, "invitee@example.com", "correct horse battery staple 8")
  expect(typeof cookie).toBe("string")

  // It traversed the profile trigger too (Task 7): a profile exists for
  // the freshly-created account, carrying the display name the invitee
  // chose. `name` is a required argument now — there is no email fallback
  // left, which is the point: every account has a name a human picked.
  const profile = await t.run(async (ctx) =>
    ctx.db
      .query("profiles")
      .filter((q) => q.eq(q.field("displayName"), "Invité·e"))
      .first(),
  )
  expect(profile).not.toBeNull()

  const row = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(row?.acceptedAt).toBeDefined()
})

// --- C1 (review, critical) : un mot de passe faible ne grante rien -------

// `/admin/create-user` itself has no length floor on `password` at all
// (verified in `routes.mjs`: `password: z.string().optional()`), and an
// empty string is falsy there, so `createUser` used to skip linking a
// credential account entirely — a permanently locked-out, credential-less
// account, burning the invitation for good (`USER_ALREADY_EXISTS` on any
// re-invite attempt). Both cases must be refused *before* `createUser` is
// ever called, and the invitation must survive the rejected attempt so a
// legitimate retry with a real password still works.
test("accept refuse un mot de passe vide, et l'invitation reste utilisable", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  await expect(t.mutation(api.invitations.accept, { name: "Invité·e", token, password: "" })).rejects.toThrow(
    /WEAK_PASSWORD/,
  )

  const row = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(row?.acceptedAt).toBeUndefined()

  // The invitation is genuinely still good: a real password succeeds.
  const result = await t.mutation(api.invitations.accept, {
    name: "Invité·e",
    token,
    password: "correct horse battery staple weak1",
  })
  expect(result).toEqual({ email: "invitee@example.com", role: "editor" })
})

test("accept refuse un mot de passe d'un seul caractère, et l'invitation reste utilisable", async () => {
  const t = makeTestConvex()
  // I1: an `owner` actor — this test invites `role: "admin"` specifically
  // to prove the eventual account keeps that role, and `admin` is refused
  // to an `admin` actor now.
  const asOwner = await seedOwner(t)
  const { token } = await asOwner.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "admin",
  })

  await expect(t.mutation(api.invitations.accept, { name: "Invité·e", token, password: "a" })).rejects.toThrow(
    /WEAK_PASSWORD/,
  )

  const row = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(row?.acceptedAt).toBeUndefined()

  // No credential account was created for that email either — a fresh
  // accept with a real password must still work, not collide with a
  // half-created zombie.
  const result = await t.mutation(api.invitations.accept, {
    name: "Invité·e",
    token,
    password: "correct horse battery staple weak2",
  })
  expect(result).toEqual({ email: "invitee@example.com", role: "admin" })
})

// I4 (Lot 1 final review): the two tests above only ever exercised
// lengths 0 and 1 — nothing pinned the upper bound (`MAX_PASSWORD_LENGTH`,
// 128) at all, and `MIN_PASSWORD_LENGTH` (8) was unpinned in the sense
// that setting it to 2 would have left both existing tests green (a
// password of length 0 or 1 is refused either way). These two close both
// gaps: exactly one character under the floor, and exactly one character
// over the ceiling.
test("I4 : accept refuse un mot de passe d'exactement 7 caractères (un de moins que le plancher)", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  const sevenChars = "a".repeat(7)
  expect(sevenChars).toHaveLength(7)
  await expect(
    t.mutation(api.invitations.accept, { name: "Invité·e", token, password: sevenChars }),
  ).rejects.toThrow(/WEAK_PASSWORD/)

  const row = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(row?.acceptedAt).toBeUndefined()
})

test("I4 : accept refuse un mot de passe de 129 caractères (un de plus que le plafond)", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  const tooLong = "a".repeat(129)
  expect(tooLong).toHaveLength(129)
  await expect(
    t.mutation(api.invitations.accept, { name: "Invité·e", token, password: tooLong }),
  ).rejects.toThrow(/WEAK_PASSWORD/)

  const row = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(row?.acceptedAt).toBeUndefined()
})

// --- I2 (review) : l'invitation ne survit pas à la perte d'autorité de ---
// --- son émetteur ----------------------------------------------------------

test("accept refuse si l'émetteur de l'invitation a été banni depuis (BANNED)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "owner@example.com",
    password: "correct horse battery staple i2a",
    name: "Owner",
    role: "owner",
  })
  const issuer = await seedUser(t, {
    email: "issuer@example.com",
    password: "correct horse battery staple i2b",
    name: "Issuer",
    role: "admin",
  })
  const ownerCookie = await signIn(t, "owner@example.com", "correct horse battery staple i2a")
  await signIn(t, "issuer@example.com", "correct horse battery staple i2b")
  const asIssuer = await identityFor(t, issuer.id)

  // I1: the invited role is incidental to what this test proves (the
  // issuer's authority being revoked after the fact) — `editor`, not
  // `admin`, since an `admin` actor is refused `role: "admin"` at `create`
  // now.
  const { token } = await asIssuer.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  const banRes = await t.fetch("/api/auth/admin/ban-user", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: issuer.id }),
  })
  expect(banRes.status).toBe(200)

  await expect(
    t.mutation(api.invitations.accept, {
      name: "Invité·e",
      token,
      password: "correct horse battery staple i2c",
    }),
  ).rejects.toThrow(/BANNED/)

  const row = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(row?.acceptedAt).toBeUndefined()
})

test("accept refuse si l'émetteur a été rétrogradé en editor depuis (FORBIDDEN)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "owner@example.com",
    password: "correct horse battery staple i2d",
    name: "Owner",
    role: "owner",
  })
  const issuer = await seedUser(t, {
    email: "issuer@example.com",
    password: "correct horse battery staple i2e",
    name: "Issuer",
    role: "admin",
  })
  const ownerCookie = await signIn(t, "owner@example.com", "correct horse battery staple i2d")
  await signIn(t, "issuer@example.com", "correct horse battery staple i2e")
  const asIssuer = await identityFor(t, issuer.id)

  // I1: same note as the BANNED test above — `editor`, not `admin`.
  const { token } = await asIssuer.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  const demoteRes = await t.fetch("/api/auth/admin/set-role", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: issuer.id, role: "editor" }),
  })
  expect(demoteRes.status).toBe(200)

  await expect(
    t.mutation(api.invitations.accept, {
      name: "Invité·e",
      token,
      password: "correct horse battery staple i2f",
    }),
  ).rejects.toThrow(/FORBIDDEN/)

  const row = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(row?.acceptedAt).toBeUndefined()
})

test("accept refuse si l'émetteur a été supprimé depuis (UNAUTHENTICATED)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "owner@example.com",
    password: "correct horse battery staple i2g",
    name: "Owner",
    role: "owner",
  })
  const issuer = await seedUser(t, {
    email: "issuer@example.com",
    password: "correct horse battery staple i2h",
    name: "Issuer",
    role: "admin",
  })
  const ownerCookie = await signIn(t, "owner@example.com", "correct horse battery staple i2g")
  await signIn(t, "issuer@example.com", "correct horse battery staple i2h")
  const asIssuer = await identityFor(t, issuer.id)

  // I1: same note as the BANNED test above — `editor`, not `admin`.
  const { token } = await asIssuer.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  const removeRes = await t.fetch("/api/auth/admin/remove-user", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: issuer.id }),
  })
  expect(removeRes.status).toBe(200)

  await expect(
    t.mutation(api.invitations.accept, {
      name: "Invité·e",
      token,
      password: "correct horse battery staple i2i",
    }),
  ).rejects.toThrow(/UNAUTHENTICATED/)

  const row = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(row?.acceptedAt).toBeUndefined()
})

// Control: an issuer whose authority hasn't changed still works — the
// three tests above prove refusal, this proves the check isn't refusing
// everything.
test("contrôle : accept réussit quand l'émetteur est toujours owner ou admin (chemin réel)", async () => {
  const t = makeTestConvex()
  const issuer = await seedUser(t, {
    email: "issuer@example.com",
    password: "correct horse battery staple i2j",
    name: "Issuer",
    role: "admin",
  })
  await signIn(t, "issuer@example.com", "correct horse battery staple i2j")
  const asIssuer = await identityFor(t, issuer.id)

  const { token } = await asIssuer.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  const result = await t.mutation(api.invitations.accept, {
    name: "Invité·e",
    token,
    password: "correct horse battery staple i2k",
  })
  expect(result).toEqual({ email: "invitee@example.com", role: "editor" })
})

// --- M5 (review) : `name` est borné comme `profiles.displayName` ---------

test("accept refuse un name vide après trim", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  await expect(
    t.mutation(api.invitations.accept, {
      token,
      password: "correct horse battery staple m5a",
      name: "   ",
    }),
  ).rejects.toThrow(/INVALID_NAME/)
})

test("accept refuse un name de plus de 100 caractères", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  await expect(
    t.mutation(api.invitations.accept, {
      token,
      password: "correct horse battery staple m5b",
      name: "x".repeat(101),
    }),
  ).rejects.toThrow(/INVALID_NAME/)
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
    name: "Invité·e",
    token: firstToken,
    password: "correct horse battery staple 9",
  })

  // Minor (Lot 1 final review): `create` itself now refuses a second
  // invitation for an email that already has an account (see
  // `ACCOUNT_ALREADY_EXISTS`, tested separately) — this test's actual
  // subject is `accept`'s own, independent defense against a duplicate
  // account, which still matters for a row that reaches the table by any
  // other path (a migration, a bug, a direct write) than `create`. Seeded
  // directly, the same idiom this file already uses elsewhere for that
  // exact reason (e.g. the rogue-owner-invitation test above) — with a
  // *real* issuer id, not a placeholder string, since `accept` now
  // re-verifies `invitedBy` (I2) before ever reaching the
  // duplicate-account check this test is actually about.
  const issuer = await seedUser(t, {
    email: "second-issuer@example.com",
    password: "correct horse battery staple second-issuer",
    name: "Second Issuer",
    role: "admin",
  })
  const { token: secondToken, hash: secondHash } = await generateToken()
  await t.run(async (ctx) =>
    ctx.db.insert("invitations", {
      email: "invitee@example.com",
      role: "editor",
      tokenHash: secondHash,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7,
      invitedBy: issuer.id,
    }),
  )

  // Minor (Lot 1 final review): pinned to better-auth's own
  // "already exists" message — the actual invariant this test names —
  // rather than a bare `rejects.toThrow()`, which would pass identically
  // for any unrelated failure (a typo in this test setup included).
  await expect(
    t.mutation(api.invitations.accept, {
      name: "Invité·e",
      token: secondToken,
      password: "correct horse battery staple 10",
    }),
  // Le refus porte désormais un code, et non plus le message anglais de
  // Better Auth : c'est la même défense, mais celle-ci, l'écran sait la
  // traduire à qui a cliqué sur le lien.
  ).rejects.toThrow(/ACCOUNT_ALREADY_EXISTS/)

  const rows = await t.run(async (ctx) => ctx.db.query("invitations").collect())
  const second = rows.find((r) => r.tokenHash === secondHash)
  expect(second?.acceptedAt).toBeUndefined()
})

// --- L'échec d'envoi de l'email ne doit pas annuler l'invitation ---------

// Ruling 4: the send is scheduled, not inline — so whatever happens inside
// it (missing RESEND_API_KEY here, since these tests never set one; a
// Resend outage in real life) must never roll back the invitation itself.
// `finishAllScheduledFunctions` (see `runScheduledFunctions` above)
// explicitly tolerates the scheduled function failing — the point of this
// test is that its failure never reaches the caller of `create`, and the
// token it returned is still good afterward.
test("un échec d'envoi de l'email n'invalide pas l'invitation : le token reste utilisable", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)

  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  // Let the scheduled send run (and fail — no RESEND_API_KEY is set in
  // this test environment) without that failure propagating here.
  await runScheduledFunctions(t)

  const result = await t.mutation(api.invitations.accept, {
    name: "Invité·e",
    token,
    password: "correct horse battery staple 11",
  })
  expect(result).toEqual({ email: "invitee@example.com", role: "editor" })
})

// I3 (review): a missing `SITE_URL` used to make `sendInvitationEmail`
// return silently — no email, no error, no log, indistinguishable from a
// successful send anywhere an operator would look. It must now surface as
// a *failed* scheduled function (visible in the dashboard), not a quiet
// no-op — checked directly against the scheduled function's own recorded
// state, not just "did this test's own call throw".
// Round 2 (review, item 2): the original version of this test only
// asserted `state.kind === "failed"` after going through the real
// `create` -> scheduler -> `sendInvitationEmail` pipeline — but no test in
// this file ever sets `RESEND_API_KEY`, so `resend.sendEmail` throws "API
// key is not set" regardless of `SITE_URL`. That made the assertion true
// whether or not the `SITE_URL` guard existed at all: deleting the guard
// entirely still leaves the job "failed", for the unrelated downstream
// reason. Non-discriminating — it couldn't have caught the guard being
// removed.
//
// Fixed by invoking `sendInvitationEmail` directly (bypassing the
// scheduler, which discards the thrown message — convex-test's own
// `_scheduled_functions` state never records more than `{kind: "failed"}`,
// no error text) and asserting the *specific* rejection message. This
// discriminates for real: `sendInvitationEmail` checks `SITE_URL` before
// ever calling `resend.sendEmail`, so if that check were removed, the
// exact same setup (no `RESEND_API_KEY`, no `SITE_URL`) would instead
// reject with "API key is not set" — a different message, failing this
// assertion. No `RESEND_API_KEY` is needed for that reason: the guard this
// test targets runs, and the function throws, before `resend.sendEmail`
// (and any risk of a real network call) is ever reached.
test("l'absence de SITE_URL fait échouer sendInvitationEmail avec un message explicite, pas un retour silencieux", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  delete process.env.SITE_URL

  await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })
  const invitationId = await t.run(async (ctx) => (await ctx.db.query("invitations").first())!._id)

  await expect(
    t.action(internal.invitations.sendInvitationEmail, { invitationId }),
  ).rejects.toThrow(/SITE_URL is not set/)
})

// --- L'entropie du token : deux invitations n'ont jamais le même --------

// The available, cheap check (see `lib/token.ts`'s header for what this
// does and does not prove about the underlying entropy source): two
// separate `create` calls must never produce the same plaintext token.
// This alone can't distinguish real entropy from Convex's documented
// per-call-varying-but-replay-identical seeding of `Math.random()` — it
// would pass either way — but a *failure* here would be an immediate,
// unambiguous stop signal.
test("deux invitations créées séparément n'ont jamais le même token", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)

  const { token: first } = await asAdmin.mutation(api.invitations.create, {
    email: "first@example.com",
    role: "editor",
  })
  const { token: second } = await asAdmin.mutation(api.invitations.create, {
    email: "second@example.com",
    role: "editor",
  })

  expect(first).not.toBe(second)
})

// --- Relecture finale, correctif 2 : trace d'audit ------------------------
//
// `create` est le seul chemin par lequel un compte — et le rôle qui va
// avec — peut naître dans ce système (commentaire d'en-tête de ce
// fichier). `users.setRole` journalise déjà tout changement de rôle sur un
// compte existant ; ce test prouve que le second chemin qui en accorde
// un, celui-ci, en laisse une trace lui aussi — un owner qui invite un
// second admin devait auparavant pouvoir le faire sans qu'`auditLog` n'en
// garde rien.
test("create laisse une trace nommant l'acteur, l'email invité et le rôle proposé", async () => {
  const t = makeTestConvex()
  const email = "owner-audit-invitation@example.com"
  const password = "correct horse battery staple audit invitation"
  const owner = await seedUser(t, { email, password, name: "Owner Audit", role: "owner" })
  await signIn(t, email, password)
  const asOwner = await identityFor(t, owner.id)

  await asOwner.mutation(api.invitations.create, {
    email: "second-admin@example.com",
    role: "admin",
  })

  const lignes = await t.run((ctx) => ctx.db.query("auditLog").collect())
  expect(lignes).toHaveLength(1)
  expect(lignes[0]?.action).toBe("invitation.create")
  expect(lignes[0]?.acteurId).toBe(owner.id)
  expect(lignes[0]?.acteurNom).toBe("Owner Audit")
  expect(lignes[0]?.cible).toBe("second-admin@example.com")
  expect(lignes[0]?.detail).toBe("admin")
})

// --- I5 (review) : list, pour retrouver et administrer les invitations ---

test("list renvoie les invitations sans jamais exposer tokenHash ou pendingToken", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  const rows = await asAdmin.query(api.invitations.list, {})
  expect(rows).toHaveLength(1)
  const row = rows[0]!
  expect(row.email).toBe("invitee@example.com")
  expect(row.role).toBe("editor")
  expect(row.acceptedAt).toBeUndefined()
  expect(typeof row.expiresAt).toBe("number")
  expect(typeof row.invitedBy).toBe("string")
  expect(row).not.toHaveProperty("tokenHash")
  expect(row).not.toHaveProperty("pendingToken")
  expect(row).not.toHaveProperty("scheduledEmailId")
})

test("un editor ne peut pas lister les invitations", async () => {
  const t = makeTestConvex()
  const editor = await seedUser(t, {
    email: "editor@example.com",
    password: "correct horse battery staple list1",
    name: "Editor",
    role: "editor",
  })
  await signIn(t, "editor@example.com", "correct horse battery staple list1")
  const asEditor = await identityFor(t, editor.id)

  await expect(asEditor.query(api.invitations.list, {})).rejects.toThrow(/FORBIDDEN/)
})

test("list refuse un appel non authentifié", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.invitations.list, {})).rejects.toMatchObject({
    data: { code: "UNAUTHENTICATED" },
  })
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
    t.mutation(api.invitations.accept, { name: "Invité·e", token, password: "correct horse battery staple 12" }),
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
    name: "Invité·e",
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

// M8 (review): revoking before the scheduled send has run must cancel that
// job, not just delete the row — otherwise an invitee (or anyone who still
// has the email in their inbox) gets a link to an invitation that no
// longer exists, silently misleading rather than cleanly gone. Checked
// against the scheduled function's own recorded state, not just "no error
// was thrown".
test("revoke annule l'envoi programmé s'il n'a pas encore tourné", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })
  const invitationId = await t.run(async (ctx) => (await ctx.db.query("invitations").first())!._id)

  await asAdmin.mutation(api.invitations.revoke, { invitationId })

  const scheduled = await t.run(async (ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  )
  expect(scheduled).toHaveLength(1)
  expect(scheduled[0]?.state.kind).toBe("canceled")

  // Letting scheduled functions run to completion afterward must not
  // resurrect anything — the job is gone, not merely delayed.
  await runScheduledFunctions(t)
  const rows = await t.run(async (ctx) => ctx.db.query("invitations").collect())
  expect(rows).toHaveLength(0)
})

// Round 2 (review, item 1): `ctx.scheduler.cancel` is not a safe no-op on
// an already-*completed* action — Convex 1.45's own typedoc: "If it had
// already completed, canceling will throw an error." `sendInvitationEmail`
// is scheduled `runAfter(0)`, so by the time an operator actually revokes
// an invitation, its send job has almost always already finished (with
// `state.kind` `"failed"` or `"success"`) — the *normal* case, not an edge
// case. `revoke` now reads the job's state first and only calls `cancel`
// while it's still `pending`/`inProgress`.
//
// IMPORTANT, stated plainly rather than implied: this test does NOT, and
// cannot, discriminate between the fixed and unfixed code in this harness.
// convex-test's own `cancel` implementation (`dist/index.js`,
// `"1.0/cancel_job"`) unconditionally patches state to `{kind:
// "canceled"}` with no check of the job's current state at all, and never
// throws — so calling `revoke` after the job has completed would resolve
// here regardless of whether the state-check this fix adds exists. What
// this test *does* verify: `revoke`'s own logic (reading the job via
// `ctx.db.system.get`, branching on its state) doesn't itself throw or
// misbehave once a job has genuinely completed, and that the invitation
// row is still correctly deleted either way. Proving the actual
// throw-on-completed-cancel bug is fixed requires the real deployment —
// which is exactly what's being confirmed there, not here.
test("revoke réussit même après que l'envoi programmé a déjà terminé (ne peut pas discriminer dans ce harnais — voir commentaire)", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })
  const invitationId = await t.run(async (ctx) => (await ctx.db.query("invitations").first())!._id)

  // Let the send job run to completion (it fails — no RESEND_API_KEY — but
  // "completed" here means any terminal state, failed or succeeded).
  await runScheduledFunctions(t)
  const completed = await t.run(async (ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  )
  expect(completed[0]?.state.kind).toBe("failed")

  await expect(
    asAdmin.mutation(api.invitations.revoke, { invitationId }),
  ).resolves.not.toThrow()

  const rows = await t.run(async (ctx) => ctx.db.query("invitations").collect())
  expect(rows).toHaveLength(0)
})

// --- preview : ce qu'affiche `/accept-invite` avant que la personne ne ----
// --- saisisse quoi que ce soit — jamais authentifié, jamais le token -------
// --- lui-même en retour -----------------------------------------------------

// Unauthenticated on purpose, exactly like `accept`: the person opening the
// link has no session yet. Called on the raw `t` (no identity at all), not
// through `seedAdmin`'s signed-in handle — proving this doesn't secretly
// depend on a caller role the way `list`/`revoke` do.
test("preview renvoie l'email et le rôle d'une invitation valide, sans authentification et sans exposer le token", async () => {
  const t = makeTestConvex()
  // I1: an `owner` actor — this test invites `role: "admin"` specifically
  // to prove `preview` echoes that role back, and `admin` is refused to an
  // `admin` actor now.
  const asOwner = await seedOwner(t)
  const { token } = await asOwner.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "admin",
  })

  const result = await t.query(api.invitations.preview, { token })
  expect(result).toEqual({ email: "invitee@example.com", role: "admin" })
})

test("preview refuse un token inconnu ou corrompu (INVALID)", async () => {
  const t = makeTestConvex()
  await expect(
    t.query(api.invitations.preview, { token: "0".repeat(64) }),
  ).rejects.toThrow(/INVALID/)
})

test("preview refuse une invitation expirée (EXPIRED)", async () => {
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

  await expect(t.query(api.invitations.preview, { token })).rejects.toThrow(/EXPIRED/)
})

test("preview refuse une invitation déjà acceptée (ALREADY_ACCEPTED)", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })
  await t.mutation(api.invitations.accept, {
    name: "Invité·e",
    token,
    password: "correct horse battery staple preview1",
  })

  await expect(t.query(api.invitations.preview, { token })).rejects.toThrow(
    /ALREADY_ACCEPTED/,
  )
})

// Same ordering rule as `accept` (ruling 2): a consumed invitation that has
// since expired must still report ALREADY_ACCEPTED, never EXPIRED — so the
// page can tell "already have an account, go sign in" apart from "ask for a
// new invitation" correctly regardless of when it's opened.
test("preview : une invitation consommée puis expirée reste ALREADY_ACCEPTED, jamais EXPIRED", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })
  await t.mutation(api.invitations.accept, {
    name: "Invité·e",
    token,
    password: "correct horse battery staple preview2",
  })
  await t.run(async (ctx) => {
    const row = await ctx.db.query("invitations").first()
    await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1000 })
  })

  await expect(t.query(api.invitations.preview, { token })).rejects.toThrow(
    /ALREADY_ACCEPTED/,
  )
})

// --- Plancher de robustesse : la jauge du formulaire, appliquée --------

// The form in `accept-invite.tsx` scores the password as it is typed and
// refuses to submit below `MIN_PASSWORD_SCORE`. These tests are what makes
// that gauge more than decoration: the same function, against the same
// email, decides here too — so a caller that skips the form entirely gets
// the same answer the form would have given.

test("accept refuse un mot de passe assez long mais trivial (score sous le plancher)", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  // 9 characters, three character classes — it clears every length bound
  // this mutation had before, and it is one of the most-breached strings
  // in existence.
  await expect(
    t.mutation(api.invitations.accept, {
      token,
      password: "P@ssw0rd1",
      name: "Invité·e",
    }),
  ).rejects.toThrow(/WEAK_PASSWORD/)

  // The invitation survives the refusal, exactly like the length-bound
  // rejections above: someone who picked badly gets another go.
  const row = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(row?.acceptedAt).toBeUndefined()

  const result = await t.mutation(api.invitations.accept, {
    token,
    password: "correct horse battery staple score1",
    name: "Invité·e",
  })
  expect(result).toEqual({ email: "invitee@example.com", role: "editor" })
})

test("accept refuse un mot de passe fabriqué à partir de l'email invité", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "marmotte@example.com",
    role: "editor",
  })

  // Scored against `invite.email` — the address on the invitation row, read
  // server-side — never an address the caller passed in. That is what makes
  // this check unbypassable from the client: there is no email argument to
  // lie about.
  await expect(
    t.mutation(api.invitations.accept, {
      token,
      password: "Marmotte2026!",
      name: "Marmotte",
    }),
  ).rejects.toThrow(/WEAK_PASSWORD/)

  const row = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(row?.acceptedAt).toBeUndefined()
})

// --- Le pseudo est obligatoire ------------------------------------------

test("accept refuse un pseudo vide, et l'invitation reste utilisable", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  await expect(
    t.mutation(api.invitations.accept, {
      token,
      password: "correct horse battery staple name1",
      name: "",
    }),
  ).rejects.toThrow(/INVALID_NAME/)

  const row = await t.run(async (ctx) => ctx.db.query("invitations").first())
  expect(row?.acceptedAt).toBeUndefined()
})

test("le pseudo choisi devient le displayName du profil, sans repli sur l'email", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  const { token } = await asAdmin.mutation(api.invitations.create, {
    email: "invitee@example.com",
    role: "editor",
  })

  await t.mutation(api.invitations.accept, {
    token,
    password: "correct horse battery staple name2",
    // Surrounding whitespace is trimmed, not refused — someone who pastes
    // their name with a stray space should not be told their name is
    // invalid.
    name: "  Marmotte Verte  ",
  })

  const profile = await t.run(async (ctx) =>
    ctx.db
      .query("profiles")
      .filter((q) => q.eq(q.field("displayName"), "Marmotte Verte"))
      .first(),
  )
  expect(profile).not.toBeNull()

  // And nothing anywhere fell back to the email address.
  const byEmail = await t.run(async (ctx) =>
    ctx.db
      .query("profiles")
      .filter((q) => q.eq(q.field("displayName"), "invitee@example.com"))
      .first(),
  )
  expect(byEmail).toBeNull()
})

// --- Le gabarit de l'écran « envoi des emails » --------------------------
//
// Ce que ces tests gardent : l'invitation part par le MÊME chemin que ce
// que l'écran affiche. Sans eux, l'écran pourrait promettre un texte que
// personne ne recevrait — un réglage décoratif, ce qui est pire qu'un
// réglage absent.

type EnvoiCapture = {
  to: string | string[]
  subject: string
  html?: string
  text?: string
}

/**
 * Espionne l'envoi au niveau du prototype, et non d'une instance : le
 * client Resend est construit à l'appel (`lib/resend.ts`), donc il n'existe
 * aucune instance à intercepter avant que l'action ne tourne. Aucune clé
 * d'API n'est nécessaire — la méthode entière est remplacée.
 */
function capturerLesEnvois(): EnvoiCapture[] {
  const envoyes: EnvoiCapture[] = []
  vi.spyOn(Resend.prototype, "sendEmail").mockImplementation((async (
    _ctx: unknown,
    options: EnvoiCapture,
  ) => {
    envoyes.push(options)
    return "email-de-test"
  }) as unknown as Resend["sendEmail"])
  return envoyes
}

const INVITATION = CATALOGUE.find((email) => email.cle === "invitation")!

test("un gabarit personnalisé remplace le texte de l'invitation, lien compris", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  await asAdmin.mutation(api.emails.setTemplate, {
    cle: "invitation",
    objet: "Rejoignez Acme",
    corps: "Bonjour, ouvrez {{lien}}",
  })

  const envois = capturerLesEnvois()
  await asAdmin.mutation(api.invitations.create, {
    email: "nouveau@exemple.fr",
    role: "editor",
  })
  await runScheduledFunctions(t)

  expect(envois).toHaveLength(1)
  expect(envois[0]!.subject).toBe("Rejoignez Acme")
  expect(envois[0]!.text).toContain("Bonjour, ouvrez ")
  // Le lien est la raison d'être de cet email : il doit survivre au
  // remplacement du texte, dans les deux corps, sinon l'invitation
  // n'ouvre plus aucune porte.
  expect(envois[0]!.text).toContain("/accept-invite?token=")
  expect(envois[0]!.html).toContain("/accept-invite?token=")
})

test("une ligne de gabarit devenue invalide n'empêche pas l'invitation de partir", async () => {
  // Le scénario réel : le catalogue gagne une variable obligatoire dans une
  // version ultérieure, et les gabarits enregistrés avant ne l'ont pas.
  // L'email doit partir avec le texte du code, pas échouer.
  //
  // Écrit directement en base parce que `setTemplate` refuse ce texte
  // aujourd'hui — et c'est exactement le point : la ligne existe malgré la
  // validation d'écriture, parce qu'elle a été écrite quand elle passait.
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  await t.run(async (ctx) => {
    await ctx.db.insert("emailTemplates", {
      cle: "invitation",
      objet: "Bonjour",
      corps: "sans lien",
      actif: true,
      majPar: "un-identifiant-better-auth",
      majAt: Date.now(),
    })
  })

  const envois = capturerLesEnvois()
  await asAdmin.mutation(api.invitations.create, {
    email: "nouveau@exemple.fr",
    role: "editor",
  })
  await runScheduledFunctions(t)

  expect(envois).toHaveLength(1)
  expect(envois[0]!.subject).toContain("Invitation à rejoindre")
  expect(envois[0]!.text).toContain("/accept-invite?token=")
})

test("l'invitation part même quand la ligne dit `actif: false`", async () => {
  // `setActif` refuse déjà de l'écrire (`emails.test.ts` le garde), et
  // `gabaritPour` force `actif` à vrai sur un email non désactivable. Ce
  // test-ci garde la troisième barrière, la seule qui compte vraiment :
  // que l'ENVOI ne consulte pas un interrupteur qui n'existe pas. Une
  // ligne pareille peut arriver par une restauration de sauvegarde ou un
  // `npx convex import` — et elle fermerait sans recours le seul chemin de
  // création de compte du dépôt.
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  await t.run(async (ctx) => {
    await ctx.db.insert("emailTemplates", {
      cle: "invitation",
      actif: false,
      majPar: "un-identifiant-better-auth",
      majAt: Date.now(),
    })
  })

  const envois = capturerLesEnvois()
  await asAdmin.mutation(api.invitations.create, {
    email: "nouveau@exemple.fr",
    role: "editor",
  })
  await runScheduledFunctions(t)

  expect(envois).toHaveLength(1)
})

// --- L'origine du lien suit le domaine déclaré ---------------------------
//
// `SITE_URL` était une variable d'environnement Convex, donc figée jusqu'au
// prochain `npx convex env set`. Le jour où l'adoptant change de domaine
// depuis `/settings/domaine`, l'invitation continuait de pointer vers
// l'ancien — une panne invisible tant que personne ne clique, et celui qui
// clique est justement quelqu'un qui essaie d'entrer.
//
// Ces deux tests DISCRIMINENT, et c'est la seule chose qui compte ici :
// `SITE_URL` vaut `http://localhost:3001` dans les deux (posé par le
// `beforeEach` de ce fichier), et le domaine déclaré vaut `exemple.fr`
// dans le premier seulement. Le lien attendu diffère donc entre les deux
// pour la seule raison qu'on veut prouver. Retirer la dérivation fait
// échouer le premier ; la coder en dur fait échouer le second.

test("un domaine déclaré change l'origine du lien d'invitation", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  await t.run(async (ctx) => {
    const ligne = await ctx.db.query("settings").first()
    if (ligne) await ctx.db.patch(ligne._id, { declaredDomain: "exemple.fr" })
    else await ctx.db.insert("settings", { siteName: "Acme", declaredDomain: "exemple.fr" })
  })

  const envois = capturerLesEnvois()
  await asAdmin.mutation(api.invitations.create, {
    email: "nouveau@exemple.fr",
    role: "editor",
  })
  await runScheduledFunctions(t)

  expect(envois).toHaveLength(1)
  expect(envois[0]!.text).toContain("https://admin.exemple.fr/accept-invite?token=")
  // Et surtout : l'origine de l'environnement n'apparaît NULLE PART. Un
  // email qui porterait les deux liens serait aussi cassé qu'un email qui
  // ne porte que le mauvais.
  expect(envois[0]!.text).not.toContain(ORIGIN)
  expect(envois[0]!.html).toContain("https://admin.exemple.fr/accept-invite?token=")
})

test("sans domaine déclaré, l'origine du lien reste celle de l'environnement", async () => {
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)

  const envois = capturerLesEnvois()
  await asAdmin.mutation(api.invitations.create, {
    email: "nouveau@exemple.fr",
    role: "editor",
  })
  await runScheduledFunctions(t)

  expect(envois).toHaveLength(1)
  expect(envois[0]!.text).toContain(`${ORIGIN}/accept-invite?token=`)
})

test("un domaine invalide en base ne sort jamais dans un lien d'invitation", async () => {
  // `settings.update` refuse cette valeur, mais elle n'est pas le seul
  // chemin d'écriture de cette table. Le repli est ce qui garde le lien
  // utilisable au lieu de l'envoyer vers un hôte inexistant.
  const t = makeTestConvex()
  const asAdmin = await seedAdmin(t)
  await t.run(async (ctx) => {
    await ctx.db.insert("settings", {
      siteName: "Acme",
      declaredDomain: "exemple.fr/../pirate.fr",
    })
  })

  const envois = capturerLesEnvois()
  await asAdmin.mutation(api.invitations.create, {
    email: "nouveau@exemple.fr",
    role: "editor",
  })
  await runScheduledFunctions(t)

  expect(envois).toHaveLength(1)
  expect(envois[0]!.text).toContain(`${ORIGIN}/accept-invite?token=`)
  expect(envois[0]!.text).not.toContain("pirate.fr")
})

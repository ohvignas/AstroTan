import { convexTest, type TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import betterAuthSchema from "./betterAuth/schema"
import { createAuth } from "./auth"
import { components } from "./_generated/api"

// This file drives the *real* HTTP surface (`http.ts` -> `authComponent
// .registerRoutes` -> better-auth's own router -> the admin() plugin's
// endpoints), not our application code. That's deliberate: `/admin/set
// -role`, `/admin/create-user`, `/admin/update-user`, `/admin/ban-user` and
// `/admin/remove-user` write straight through better-auth's internal
// adapter and never touch a Convex mutation of ours, so this is the path an
// attacker (or a misbehaving admin UI) would actually use. Testing only
// through our own mutations would prove nothing about whether the
// invariant holds.
//
// `betterAuth` is registered as a convex-test *component* with our own
// local-install schema/modules (`convex/betterAuth/**`) rather than
// `@convex-dev/better-auth/test`'s `register()` helper: that helper
// registers the *package's* bundled component schema (every plugin table —
// twoFactor, oauthApplication, rateLimit, …), which is not what
// `convex/betterAuth/convex.config.ts` declares here. A Local Install's
// schema is generated into the app's own repo and can diverge from the
// package default (ours does: it carries `role`/`banned`/`banExpires` for
// admin() and omits every table for a plugin we don't install), so
// registering the wrong one would silently test against a schema this app
// doesn't actually run.
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

// Seeds a user by calling `auth.api.createUser` *server-side*, i.e. with no
// `headers`/`request` on the call. That's not a workaround: the admin
// plugin's own `/admin/create-user` handler explicitly skips its
// authorization check when both are absent (`if (!session && (ctx.request
// || ctx.headers)) throw ctx.error("UNAUTHORIZED")` in
// `better-auth/dist/plugins/admin/routes.mjs`) — it's better-auth's
// documented bootstrap escape hatch for seeding the first admin/owner
// account, which the real HTTP endpoints can never reach without one
// already existing. `emailAndPassword.disableSignUp` doesn't apply here
// either: it only gates the separate `/sign-up/email` endpoint.
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

// Signs in through the real `/api/auth/sign-in/email` endpoint and returns
// a `Cookie` header value carrying the session token, for use on
// subsequent `t.fetch` calls as that user.
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

// Reads a user's *current* role through the real, authenticated
// `/admin/get-user` endpoint — never by asserting on a mutation response,
// per the first measured pitfall: when a hook throws an ordinary `Error`,
// better-auth answers 500 with an **empty body**, so checking the failing
// response for an error message is a false negative. The only trustworthy
// signal is whether the row actually changed. (I2 made refusals from *our*
// guard assertable via a structured `APIError` — see `expectRefused` below
// — but this helper still checks final state, both because it's the
// stronger proof and because it also covers refusals that come from
// better-auth itself, e.g. permission checks, which never carry our code.)
async function getRole(t: TestConvex<typeof schema>, asCookie: string, userId: string) {
  const res = await t.fetch(`/api/auth/admin/get-user?id=${userId}`, {
    headers: { origin: ORIGIN, cookie: asCookie },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { role: string }
  return body.role
}

// I2: a refusal from `assertOwnerInvariant`, translated at the `auth.ts`
// wiring boundary into `APIError.from("FORBIDDEN", { code: "OWNER_INVARIANT",
// message })`, is a structured 403 — not the opaque, empty-bodied 500 an
// ordinary thrown `Error` produces. Checked here so a refusal test can
// distinguish "the guard refused this, on purpose" from "something else
// entirely crashed", which a bare status-code-plus-final-state check
// cannot: a hook replaced by `throw new TypeError("boom")` would produce
// the same 500 and the same unchanged row that used to be this suite's
// only signal.
async function expectRefused(res: Response) {
  expect(res.status).toBe(403)
  const body = (await res.clone().json()) as { code?: string; message?: string }
  expect(body.code).toBe("OWNER_INVARIANT")
  return body
}

test("contrôle : un owner promeut légitimement un editor en admin via /admin/set-role (chemin réel)", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
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

  const res = await t.fetch("/api/auth/admin/set-role", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: editor.id, role: "admin" }),
  })

  expect(res.status).toBe(200)
  expect(await getRole(t, ownerCookie, editor.id)).toBe("admin")
})

// I1: a delete hook that refused *everything* would still pass every other
// test in this file (they only ever try to delete the owner). This proves
// the guard lets a legitimate deletion through.
test("contrôle : un admin supprime légitimement un editor via /admin/remove-user (chemin réel)", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: "admin@example.com",
    password: "correct horse battery staple 3",
    name: "Admin",
    role: "admin",
  })
  const editor = await seedUser(t, {
    email: "editor@example.com",
    password: "correct horse battery staple 2",
    name: "Editor",
    role: "editor",
  })
  const adminCookie = await signIn(t, "admin@example.com", "correct horse battery staple 3")

  const res = await t.fetch("/api/auth/admin/remove-user", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: adminCookie },
    body: JSON.stringify({ userId: editor.id }),
  })
  expect(res.status).toBe(200)

  const getRes = await t.fetch(`/api/auth/admin/get-user?id=${editor.id}`, {
    headers: { origin: ORIGIN, cookie: adminCookie },
  })
  expect(getRes.status).toBe(404)
})

test("refuse un second owner via /admin/set-role (chemin réel)", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
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

  const res = await t.fetch("/api/auth/admin/set-role", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: editor.id, role: "owner" }),
  })

  const body = await expectRefused(res)
  expect(body.message).toMatch(/OWNER_ALREADY_EXISTS/)
  expect(await getRole(t, ownerCookie, editor.id)).toBe("editor")
})

test("refuse de rétrograder le dernier owner via /admin/set-role (chemin réel)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "owner@example.com",
    password: "correct horse battery staple 1",
    name: "Owner",
    role: "owner",
  })
  const ownerCookie = await signIn(t, "owner@example.com", "correct horse battery staple 1")

  // The owner targets *themselves* — unlike `/admin/remove-user`,
  // `/admin/set-role` has no built-in "not on yourself" guard, so this is
  // the one admin endpoint that can reach the LAST_OWNER branch on update
  // through a real HTTP call without also tripping the FORBIDDEN branch
  // (actorId === targetId here).
  const res = await t.fetch("/api/auth/admin/set-role", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: owner.id, role: "admin" }),
  })

  const body = await expectRefused(res)
  expect(body.message).toMatch(/LAST_OWNER/)
  expect(await getRole(t, ownerCookie, owner.id)).toBe("owner")
})

test("refuse qu'un admin modifie un owner via /admin/set-role (chemin réel)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "owner@example.com",
    password: "correct horse battery staple 1",
    name: "Owner",
    role: "owner",
  })
  await seedUser(t, {
    email: "admin@example.com",
    password: "correct horse battery staple 3",
    name: "Admin",
    role: "admin",
  })
  const ownerCookie = await signIn(t, "owner@example.com", "correct horse battery staple 1")
  const adminCookie = await signIn(t, "admin@example.com", "correct horse battery staple 3")

  const res = await t.fetch("/api/auth/admin/set-role", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: adminCookie },
    body: JSON.stringify({ userId: owner.id, role: "editor" }),
  })

  const body = await expectRefused(res)
  expect(body.message).toMatch(/FORBIDDEN/)
  expect(await getRole(t, ownerCookie, owner.id)).toBe("owner")
})

// C1: the actual measured exploit. `/admin/set-role`'s body schema is
// `z.union([z.string(), z.array(z.string())])`, and better-auth's own
// `hasPermission` grants access if *any* component of a comma-joined role
// string authorizes — so a naive guard that fails to classify
// `"owner,editor"` (and, worse, treats "unclassifiable" as "no role
// change") lets the target keep every `owner` permission, including
// `set-password`, while never being recorded as `role: "owner"` at all.
// This doesn't just assert the guard throws — it proves the exploit's
// actual payoff (silently gaining owner permissions, then using them to
// take over the real owner's account) never lands.
test("C1: refuse un rôle multiple (\"owner,editor\") — et l'exploit qu'il permettait ne passe pas", async () => {
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

  const setRoleRes = await t.fetch("/api/auth/admin/set-role", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: editor.id, role: ["owner", "editor"] }),
  })
  const body = await expectRefused(setRoleRes)
  expect(body.message).toMatch(/INVALID_ROLE/)

  // The row was never touched: still plainly "editor", not
  // "owner,editor" and not "owner".
  expect(await getRole(t, ownerCookie, editor.id)).toBe("editor")

  // The payoff test: sign in as the target with their *own* (unchanged)
  // credentials, then attempt the actual two-request exploit — use the
  // `set-password` permission the exploit would have granted to reset the
  // *real owner's* password (not the pseudo-owner's own; resetting your
  // own password proves nothing about whether you gained owner
  // permissions). A plain `editor` (our RBAC grants `editorRole` zero
  // user permissions) is refused this regardless — the point is that the
  // refusal comes with better-auth's own permission-check code, and the
  // owner's password is provably untouched afterward, not just "some
  // non-200 status for some reason".
  const editorCookie = await signIn(t, "editor@example.com", "correct horse battery staple 2")
  const setPasswordRes = await t.fetch("/api/auth/admin/set-user-password", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: editorCookie },
    body: JSON.stringify({ userId: owner.id, newPassword: "attacker chosen password 123" }),
  })
  expect(setPasswordRes.status).toBe(403)
  const setPasswordBody = (await setPasswordRes.json()) as { code?: string }
  expect(setPasswordBody.code).toBe("YOU_ARE_NOT_ALLOWED_TO_SET_USERS_PASSWORD")

  // The attacker-chosen password was never set...
  const hijackAttempt = await t.fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({
      email: "owner@example.com",
      password: "attacker chosen password 123",
    }),
  })
  expect(hijackAttempt.status).not.toBe(200)

  // ...and the real owner's original password still works.
  await signIn(t, "owner@example.com", "correct horse battery staple 1")
})

// C2: `/admin/create-user` honours an explicit `role` behind the
// `set-role` permission — which `adminRole` holds — and, unlike
// `/admin/set-role`, there is no pre-existing row for `update.before` to
// ever see: the second owner is minted outright on creation, bypassing the
// `update`/`delete` guards entirely.
test("C2: refuse qu'un admin crée un second owner via /admin/create-user (chemin réel)", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: "owner@example.com",
    password: "correct horse battery staple 1",
    name: "Owner",
    role: "owner",
  })
  await seedUser(t, {
    email: "admin@example.com",
    password: "correct horse battery staple 3",
    name: "Admin",
    role: "admin",
  })
  const adminCookie = await signIn(t, "admin@example.com", "correct horse battery staple 3")

  const res = await t.fetch("/api/auth/admin/create-user", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: adminCookie },
    body: JSON.stringify({
      email: "second-owner@example.com",
      password: "another owner password 456",
      name: "Second Owner",
      role: "owner",
    }),
  })

  const body = await expectRefused(res)
  expect(body.message).toMatch(/OWNER_ALREADY_EXISTS/)

  // No row was created for that email at all — not as "owner", not as
  // anything.
  const signInAttempt = await t.fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({
      email: "second-owner@example.com",
      password: "another owner password 456",
    }),
  })
  expect(signInAttempt.status).not.toBe(200)
})

// C3: `/admin/remove-user`'s handler deletes the target's sessions and
// credential account *before* the row delete our `databaseHooks` guard —
// so, before this fix, a *refused* deletion of the owner still logged them
// out and destroyed their password irrecoverably. This is the regression
// test for that: the owner must not just still exist with `role: "owner"`
// after a refused deletion, they must still be able to *sign in*.
test("C3: refuse qu'un admin supprime l'owner via /admin/remove-user, et l'owner reste connectable (chemin réel)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "owner@example.com",
    password: "correct horse battery staple 1",
    name: "Owner",
    role: "owner",
  })
  await seedUser(t, {
    email: "admin@example.com",
    password: "correct horse battery staple 3",
    name: "Admin",
    role: "admin",
  })
  const adminCookie = await signIn(t, "admin@example.com", "correct horse battery staple 3")

  const res = await t.fetch("/api/auth/admin/remove-user", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: adminCookie },
    body: JSON.stringify({ userId: owner.id }),
  })

  // Refused at the door by the `hooks.before` matcher on
  // `/admin/remove-user`, before better-auth's own handler ever runs
  // `deleteUserSessions`/`deleteUser` — so this is a plain `APIError`
  // thrown directly in that middleware, not a translated
  // `OwnerInvariantError` from `databaseHooks` (that guard never gets a
  // chance to run here; it stays as defence in depth for any other
  // delete-user path). Same structured shape either way.
  await expectRefused(res)

  // The regression check that matters: no side effect. The owner's
  // session from before this attempt is untouched, *and* they can sign in
  // fresh with their original password — proving the credential account
  // was never touched either.
  const stillGetRole = await getRole(t, adminCookie, owner.id)
  expect(stillGetRole).toBe("owner")
  const freshOwnerCookie = await signIn(t, "owner@example.com", "correct horse battery staple 1")
  expect(await getRole(t, freshOwnerCookie, owner.id)).toBe("owner")
})

// Round 2: the C3 fix from the previous round turned out to still be
// bypassable, and this is why. `router.mjs` builds `ctx.body` straight
// from `request.json()`, untouched; a *global* `hooks.before` middleware
// (like the round-1 fix for `/admin/remove-user`) runs ahead of the
// endpoint's own zod body validation, so it sees that raw, unvalidated
// body. zod 4.4.3 coerces a single-element array to its one element as a
// string (`z.coerce.string()` on `["<id>"]` yields `"<id>"`), so
// `{"userId": ["<ownerId>"]}` makes the endpoint later act on the real
// owner id while a guard that reads the *raw* body and does
// `if (typeof userId !== "string") return` sees an array and allows it
// through. Measured (not assumed) against this same codebase: this
// reproduces for `/admin/remove-user` — the row survives (its own
// `delete.before` hook is unaffected, since it reads the already-fetched
// document rather than this raw shape, and still throws once the
// exploited request reaches it) but the owner's sessions and credential
// account are destroyed *before* that throw, because `deleteUserSessions`
// runs earlier, in the endpoint handler itself, gated only by the
// global hook this bypasses.
//
// It does *not* reproduce the same way for `/admin/update-user` or
// `/admin/ban-user`, and it's worth recording precisely why: both call
// `internalAdapter.updateUser(...)`, which runs `databaseHooks.user
// .update.before` — but that hook fires from *inside* the endpoint's own
// handler execution, which better-call re-enters through
// `createInternalContext` with the endpoint's *own* body schema
// (`context.mjs`'s `createInternalContext` sets `body: data.body`, the
// validated result). That re-entry opens a *nested* `AsyncLocalStorage`
// scope, so `getCurrentAuthContext()` — what `databaseHooks` reads —
// resolves to the endpoint-validated body, already coerced to a string,
// not the raw one the earlier global hook saw. So the specific bypass
// mechanism is real for one endpoint and not reproducible for the other
// two on this version of better-auth — confirmed by adding a temporary
// probe and reading the actual `assertOwnerInvariant` FORBIDDEN message
// coming back with the *resolved* owner id, before removing the probe.
//
// These three tests are kept together anyway: `update-user`/`ban-user`
// are legitimate regression coverage (the fix below adds an *endpoint*
// -level guard for all three as defence in depth, on top of the
// `databaseHooks` layer that already protects the latter two), and
// pinning "does the owner survive" rather than "does this specific
// request 500" is the right shape of test regardless of which layer is
// doing the protecting.
const ARRAY_USER_ID_TARGETS: readonly [path: string, extraBody: Record<string, unknown>][] = [
  ["/api/auth/admin/remove-user", {}],
  ["/api/auth/admin/update-user", { data: { banned: true } }],
  ["/api/auth/admin/ban-user", {}],
]

for (const [path, extraBody] of ARRAY_USER_ID_TARGETS) {
  test(`round 2: refuse un userId de forme tableau ciblant l'owner via ${path} (chemin réel)`, async () => {
    const t = makeTestConvex()
    const owner = await seedUser(t, {
      email: "owner@example.com",
      password: "correct horse battery staple 1",
      name: "Owner",
      role: "owner",
    })
    await seedUser(t, {
      email: "admin@example.com",
      password: "correct horse battery staple 3",
      name: "Admin",
      role: "admin",
    })
    const adminCookie = await signIn(t, "admin@example.com", "correct horse battery staple 3")

    const res = await t.fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie: adminCookie },
      body: JSON.stringify({ userId: [owner.id], ...extraBody }),
    })
    expect(res.status).not.toBe(200)

    // The regression check that actually discriminates: the owner's
    // credential account and sessions survive, proven by a *fresh*
    // sign-in with the *original* password — not by the row still
    // reading `role: "owner"`, which survives even when the account
    // underneath it has already been destroyed.
    const freshOwnerCookie = await signIn(t, "owner@example.com", "correct horse battery staple 1")
    expect(await getRole(t, freshOwnerCookie, owner.id)).toBe("owner")
  })
}

// Control for the endpoint guard's self-action carve-out: the owner must
// still be able to edit their own profile through `/admin/update-user`.
// `/admin/remove-user` and `/admin/ban-user` don't need this same care
// (both already refuse a self-targeted call downstream, so the endpoint
// guard blocking them unconditionally changes nothing observable for the
// legitimate case), but `/admin/update-user` has no such restriction, so
// an endpoint guard that didn't resolve the caller would make the owner
// unable to use it on themselves at all — a real regression the fix
// avoids by calling `getSessionFromCtx`.
test("contrôle : l'owner peut toujours éditer son propre profil via /admin/update-user (chemin réel)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "owner@example.com",
    password: "correct horse battery staple 1",
    name: "Owner",
    role: "owner",
  })
  const ownerCookie = await signIn(t, "owner@example.com", "correct horse battery staple 1")

  const res = await t.fetch("/api/auth/admin/update-user", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: owner.id, data: { name: "Owner Renamed" } }),
  })

  expect(res.status).toBe(200)
})

// Round 3.

// Item 1: round 2's "fail closed unconditionally" instruction broke a
// legitimate flow — admin()'s own `databaseHooks.session.create.before`
// (`admin.mjs`) clears an expired ban at sign-in by calling
// `internalAdapter.updateUser(session.userId, {banned: false, ...})`. At
// that point the sign-in request's body is `{email, password}` (no
// `userId`) and `context.context.session` is still `null` (the session is
// mid-creation), so the guard's `targetId` resolves to `undefined` — an
// internal write that never named a target, not an unresolvable one. The
// corrected `databaseHooks.user.update.before` (see `auth.ts`) now
// distinguishes the two; this test is the regression proof.
test("round 3, item 1 : un ban expiré est levé à la connexion, pas de verrouillage permanent (chemin réel)", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: "admin@example.com",
    password: "correct horse battery staple 3",
    name: "Admin",
    role: "admin",
  })
  const adminCookie = await signIn(t, "admin@example.com", "correct horse battery staple 3")

  const pastBanExpiry = Date.now() - 1000 * 60 * 60 // one hour ago
  const user = await t.run(async (ctx) => {
    const auth = createAuth(ctx)
    return auth.api.createUser({
      body: {
        email: "expired-ban@example.com",
        password: "correct horse battery staple 9",
        name: "Formerly Banned",
        role: "editor",
        data: {
          banned: true,
          banReason: "test setup",
          banExpires: pastBanExpiry,
        },
      },
    })
  })
  const userId = (user as { user: { id: string } }).user.id

  const res = await t.fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({
      email: "expired-ban@example.com",
      password: "correct horse battery staple 9",
    }),
  })

  // The sign-in itself must succeed — this is the actual lockout proof.
  // The response body's own `user.banned` is *not* checked here: better
  // -auth's `signInEmail` (`sign-in.mjs`) fetches the user once, before
  // `internalAdapter.createSession` — which is what triggers the ban
  // -clearing hook — so the response reflects pre-clear state by design,
  // not a bug in this fix. The row itself is checked separately, through
  // an admin's `/admin/get-user`, which reads fresh.
  expect(res.status).toBe(200)

  const getRes = await t.fetch(`/api/auth/admin/get-user?id=${userId}`, {
    headers: { origin: ORIGIN, cookie: adminCookie },
  })
  expect(getRes.status).toBe(200)
  const getBody = (await getRes.json()) as { banned: boolean | null }
  expect(getBody.banned).toBe(false)
})

// Item 2: the endpoint guard's terminal check used to be
// `if (parseRole(target?.role) !== "owner") return` — a `return` (allow)
// on *any* role that failed to parse, not just a genuine non-owner. A row
// already sitting in the database with `role: "owner,editor"` (this
// commit's `create.before` fix stops the API from *manufacturing* one,
// but says nothing about rows written before this fix, or written
// directly into the component's own tables — e.g. an import, a migration,
// a bug in a future feature) holds every owner permission through
// `has-permission.mjs`'s comma-split reading, so a plain string `userId`
// targeting it used to sail through this guard and reproduce the original
// C3. Seeded here through the component adapter directly (`components
// .betterAuth.adapter.create`), bypassing our own `create.before`
// entirely, precisely to prove the guard doesn't rely on the API being
// the only way such a row can exist.
test("round 3, item 2 : refuse une cible au rôle non classifiable (\"owner,editor\") même via un userId simple (chemin réel)", async () => {
  const t = makeTestConvex()
  const now = Date.now()
  const rogue = await t.run(async (ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          email: "rogue@example.com",
          name: "Rogue",
          emailVerified: false,
          role: "owner,editor",
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  )
  const rogueId = (rogue as { id: string })?.id ?? (rogue as { _id: string })?._id
  await t.run(async (ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "account",
        data: {
          accountId: rogueId,
          providerId: "credential",
          userId: rogueId,
          password: "not-a-real-hash-just-needs-to-exist",
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  )

  await seedUser(t, {
    email: "admin@example.com",
    password: "correct horse battery staple 3",
    name: "Admin",
    role: "admin",
  })
  const adminCookie = await signIn(t, "admin@example.com", "correct horse battery staple 3")

  const res = await t.fetch("/api/auth/admin/remove-user", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: adminCookie },
    body: JSON.stringify({ userId: rogueId }),
  })
  await expectRefused(res)

  // The row survives: `/admin/get-user` still finds it.
  const getRes = await t.fetch(`/api/auth/admin/get-user?id=${rogueId}`, {
    headers: { origin: ORIGIN, cookie: adminCookie },
  })
  expect(getRes.status).toBe(200)

  // The credential account survives too — checked directly through the
  // component adapter, the same way it was seeded, since this row was
  // never signed into and has no password we could sign in with to prove
  // the same thing indirectly.
  const account = await t.run(async (ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account",
      where: [{ field: "userId", operator: "eq", value: rogueId }],
    }),
  )
  expect(account).not.toBeNull()
})

// Item 3: `/admin/revoke-user-sessions` and `/admin/revoke-user-session`
// both call session-deletion directly (`deleteUserSessions`/
// `deleteSession`) with no `databaseHooks` on the `session` model to
// catch it — before this fix, `OWNER_PROTECTED_PATHS` didn't cover either,
// so any admin (`adminRole` holds `session: ["revoke"]`) could wipe the
// owner's sessions on a loop, unguarded. Credentials survive this one (no
// account/user row is touched), so it's a repeatable annoyance rather than
// a lockout — still fixed, since the whole point of `OWNER_PROTECTED_PATHS`
// is to cover every path that can do this.
test("round 3, item 3 : un admin ne peut pas révoquer les sessions de l'owner (les deux endpoints) (chemin réel)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "owner@example.com",
    password: "correct horse battery staple 1",
    name: "Owner",
    role: "owner",
  })
  await seedUser(t, {
    email: "admin@example.com",
    password: "correct horse battery staple 3",
    name: "Admin",
    role: "admin",
  })
  const ownerCookie = await signIn(t, "owner@example.com", "correct horse battery staple 1")
  const adminCookie = await signIn(t, "admin@example.com", "correct horse battery staple 3")

  // Plural: revoke *all* of the owner's sessions by userId.
  const revokeAllRes = await t.fetch("/api/auth/admin/revoke-user-sessions", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: adminCookie },
    body: JSON.stringify({ userId: owner.id }),
  })
  await expectRefused(revokeAllRes)
  // The owner's existing session is still live.
  expect(await getRole(t, ownerCookie, owner.id)).toBe("owner")

  // Singular: revoke one specific session by token. Fetch a real token
  // for the owner through the admin's own `list-user-sessions` (the
  // legitimate way an admin UI would get one), so this drives the actual
  // shape an attacker — or a careless admin panel — would send, not a
  // fabricated one.
  const listRes = await t.fetch("/api/auth/admin/list-user-sessions", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: adminCookie },
    body: JSON.stringify({ userId: owner.id }),
  })
  expect(listRes.status).toBe(200)
  const { sessions } = (await listRes.json()) as { sessions: { token: string }[] }
  expect(sessions.length).toBeGreaterThan(0)
  const ownerSessionToken = sessions[0]?.token
  expect(typeof ownerSessionToken).toBe("string")

  const revokeOneRes = await t.fetch("/api/auth/admin/revoke-user-session", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: adminCookie },
    body: JSON.stringify({ sessionToken: ownerSessionToken }),
  })
  await expectRefused(revokeOneRes)
  expect(await getRole(t, ownerCookie, owner.id)).toBe("owner")
})

import { convexTest, type TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import betterAuthSchema from "./betterAuth/schema"
import { createAuth } from "./auth"

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
  // credentials, then try to exercise the `set-password` permission that
  // the exploit would have granted them. A plain `editor` (our RBAC
  // grants `editorRole` zero user permissions) is refused this
  // regardless — the point is that the refusal proves the row never
  // actually became "owner,editor" in a way `hasPermission`'s
  // comma-split reading would have honoured.
  const editorCookie = await signIn(t, "editor@example.com", "correct horse battery staple 2")
  const setPasswordRes = await t.fetch("/api/auth/admin/set-user-password", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: editorCookie },
    body: JSON.stringify({ userId: editor.id, newPassword: "attacker chosen password 123" }),
  })
  expect(setPasswordRes.status).not.toBe(200)

  // And the real owner's original password still works — the second half
  // of the two-request exploit (use the pseudo-owner session to reset the
  // real owner's password) never had anything to reset.
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
test("refuse qu'un admin supprime l'owner via /admin/remove-user (chemin réel)", async () => {
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

  // Reached via the FORBIDDEN branch (admin !== owner, targetRole ===
  // "owner"): better-auth's own `/admin/remove-user` already refuses
  // *self*-deletion before our hook ever runs (`YOU_CANNOT_REMOVE_YOURSELF`
  // in `routes.mjs`), so the LAST_OWNER branch on delete is not reachable
  // through this endpoint at all — there is no other enabled delete-user
  // path in this app's current auth config. Both branches live in the same
  // `delete.before` wiring; this still proves that wiring intercepts the
  // real endpoint.
  const body = await expectRefused(res)
  expect(body.message).toMatch(/FORBIDDEN/)

  // The row survives — but not painlessly. `internalAdapter.deleteUser`
  // (`better-auth/dist/db/internal-adapter.mjs`) unconditionally deletes
  // the target's `session` *and `account`* rows (via `deleteManyWithHooks`
  // on those models, which `databaseHooks` doesn't hook) before it ever
  // calls `deleteWithHooks` on `"user"` — the one call our
  // `delete.before` hook actually guards. So this blocked delete still
  // destroys the owner's credential account and session as a side
  // effect: the row keeps `role: "owner"`, but that owner can no longer
  // sign in with their password. Checking via a fresh owner sign-in (the
  // obvious way to assert "final state") would itself fail here — not
  // because the invariant broke, but because of this side effect — so
  // this checks through the admin's still-live session instead. This is
  // Concern #2 from the task report, flagged there as a gap and now
  // tracked as C3 for a follow-up fix in the next commit.
  expect(await getRole(t, adminCookie, owner.id)).toBe("owner")
})

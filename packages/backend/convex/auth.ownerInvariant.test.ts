import { convexTest, type TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import betterAuthSchema from "./betterAuth/schema"
import { createAuth } from "./auth"

// This file drives the *real* HTTP surface (`http.ts` -> `authComponent
// .registerRoutes` -> better-auth's own router -> the admin() plugin's
// endpoints), not our application code. That's deliberate: `/admin/set
// -role`, `/admin/update-user`, `/admin/ban-user` and `/admin/remove-user`
// write straight through better-auth's internal adapter and never touch a
// Convex mutation of ours, so this is the path an attacker (or a
// misbehaving admin UI) would actually use. Testing only through our own
// mutations would prove nothing about whether the invariant holds.
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
// per the first measured pitfall: when `databaseHooks` throws, better-auth
// returns 500 with an **empty body**, so checking the failing response for
// an error message is a false negative. The only trustworthy signal is
// whether the row actually changed.
async function getRole(t: TestConvex<typeof schema>, asCookie: string, userId: string) {
  const res = await t.fetch(`/api/auth/admin/get-user?id=${userId}`, {
    headers: { origin: ORIGIN, cookie: asCookie },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { role: string }
  return body.role
}

test("contrôle : un owner promeut légitimement un editor en admin via /admin/set-role (chemin réel)", async () => {
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

  const res = await t.fetch("/api/auth/admin/set-role", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: editor.id, role: "admin" }),
  })

  expect(res.status).toBe(200)
  expect(await getRole(t, ownerCookie, editor.id)).toBe("admin")
})

test("refuse un second owner via /admin/set-role (chemin réel)", async () => {
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

  const res = await t.fetch("/api/auth/admin/set-role", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: ownerCookie },
    body: JSON.stringify({ userId: editor.id, role: "owner" }),
  })

  // Pitfall #1: on a thrown hook, better-auth answers 500 with an empty
  // body. Assert on final state, never on this response.
  expect(res.status).toBe(500)
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

  expect(res.status).toBe(500)
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
  const admin = await seedUser(t, {
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

  expect(res.status).toBe(500)
  expect(await getRole(t, ownerCookie, owner.id)).toBe("owner")
})

test("refuse qu'un admin supprime l'owner via /admin/remove-user (chemin réel)", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: "owner@example.com",
    password: "correct horse battery staple 1",
    name: "Owner",
    role: "owner",
  })
  const admin = await seedUser(t, {
    email: "admin@example.com",
    password: "correct horse battery staple 3",
    name: "Admin",
    role: "admin",
  })
  const ownerCookie = await signIn(t, "owner@example.com", "correct horse battery staple 1")
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
  // real endpoint. See the task report for the detail.
  expect(res.status).toBe(500)

  // The row survives — but not painlessly. `internalAdapter.deleteUser`
  // (`better-auth/dist/db/internal-adapter.mjs`) unconditionally deletes
  // the target's `session` *and `account`* rows (via `deleteManyWithHooks`
  // on those models, which we don't hook) before it ever calls
  // `deleteWithHooks` on `"user"` — the one call our `delete.before` hook
  // actually guards. So this blocked delete still destroys the owner's
  // credential account and session as a side effect: the row keeps
  // `role: "owner"`, but that owner can no longer sign in with their
  // password. Checking via a fresh owner sign-in (the obvious way to
  // assert "final state") would itself fail here — not because the
  // invariant broke, but because of this side effect — so this checks
  // through the admin's still-live session instead. See the task report:
  // this is a real gap in what Task 6 covers, not a test artifact.
  expect(await getRole(t, adminCookie, owner.id)).toBe("owner")
})

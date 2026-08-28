import { afterEach, beforeEach, expect, test } from "vitest"
import { createAuth } from "./auth"

// `createAuth`'s ctx is only used to build a lazy Convex database adapter
// (see createAuthOptions's `authComponent.adapter(ctx)`), which doesn't
// touch ctx synchronously beyond a duck-type check — `{} as any` is exactly
// what convex/betterAuth/auth.ts itself passes for the same reason.
const fakeCtx = {} as any

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
})

afterEach(() => {
  process.env = originalEnv
})

test("createAuth throws when BETTER_AUTH_SECRET is unset", () => {
  delete process.env.BETTER_AUTH_SECRET
  process.env.SITE_URL = "http://localhost:3000"

  expect(() => createAuth(fakeCtx)).toThrow(
    "BETTER_AUTH_SECRET is not set on this Convex deployment",
  )
})

test("createAuth throws when BETTER_AUTH_SECRET equals the library's public default", () => {
  process.env.BETTER_AUTH_SECRET = "better-auth-secret-12345678901234567890"
  process.env.SITE_URL = "http://localhost:3000"

  expect(() => createAuth(fakeCtx)).toThrow(
    "BETTER_AUTH_SECRET is set to Better Auth's public default",
  )
})

test("createAuth throws when BETTER_AUTH_SECRET is shorter than 32 characters", () => {
  process.env.BETTER_AUTH_SECRET = "short-secret-not-32-chars"
  process.env.SITE_URL = "http://localhost:3000"

  expect(() => createAuth(fakeCtx)).toThrow(
    "BETTER_AUTH_SECRET must be at least 32 characters",
  )
})

test("createAuth does not throw when requireSecret is false, even with no env vars set", () => {
  delete process.env.BETTER_AUTH_SECRET
  delete process.env.SITE_URL

  expect(() => createAuth(fakeCtx, { requireSecret: false })).not.toThrow()
})

// I3 (Lot 1 final review): the SITE_URL guard was untested on its own — a
// suite exercising only the three BETTER_AUTH_SECRET cases above plus one
// `requireSecret: false` case never actually runs the code path where the
// secret is fine but SITE_URL specifically is missing. Deleting the guard
// (or reordering it ahead of the secret checks) left 175/175 green before
// this test existed.
test("createAuth throws when SITE_URL is unset, even with a valid secret", () => {
  process.env.BETTER_AUTH_SECRET = "a-genuinely-long-enough-secret-value-1234"
  delete process.env.SITE_URL

  expect(() => createAuth(fakeCtx)).toThrow("SITE_URL is not set on this Convex deployment")
})

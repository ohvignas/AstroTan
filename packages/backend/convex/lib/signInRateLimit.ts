import { HOUR, MINUTE, type RateLimitConfig } from "@convex-dev/rate-limiter"

// Sign-in rate limiting — Lot 1's deferred gate (added on review of Task 4,
// closed here before any deployment). Better Auth's own rate limiter
// defaults to `enabled: isProduction` and `storage: "memory"`; in-memory
// state cannot survive or be shared across Convex HTTP-action isolates, so
// enabling it would be a no-op in this runtime — see `auth.ts`'s wiring for
// the real mechanism (`@convex-dev/rate-limiter`, which persists in the
// database).
//
// This module is the pure, dependency-free "decision" layer — same split
// as `lib/ownerGuard.ts` (business logic) vs. `auth.ts` (the wiring
// boundary: the one `ctx.runMutation` call through the component, and the
// translation into a better-auth `APIError`). Nothing here touches a
// Convex ctx or the `rateLimiter` component client, so it's directly
// unit-testable — see `signInRateLimit.test.ts`.
//
// ## Why the key is (origin, email), not either alone
//
// The property to uphold: a given account, *and* a given origin of
// requests, can only be tried a bounded number of times in a bounded
// window. Two single-dimension designs were considered and rejected:
//
// - Per-email-only: bounds guesses against one account, but the budget is
//   *shared across every origin*. An attacker who knows a real address
//   (this app is invitation-only — every address in use was chosen by an
//   admin, not self-registered — so "knows a real address" is a realistic
//   threat, not a hypothetical one) can exhaust that account's entire
//   budget from their own machine, and the legitimate owner — signing in
//   moments later from their own, different origin — is locked out too,
//   even though they never got anything wrong. That turns the defense
//   into a denial-of-service tool against the very account it exists to
//   protect.
// - Per-origin-only: bounds how fast one machine can try things overall,
//   but the budget is *shared across every account* that machine tries.
//   It's defeated by a distributed attacker (rotate origins, budget
//   resets each time) and it collectively punishes every legitimate user
//   behind a shared address (an office NAT, a VPN exit node) for one bad
//   actor's attempts against a *different* account through the same
//   address.
//
// Keying on the pair closes both: an attacker at origin X trying account
// V's email only ever exhausts the (X, V) bucket — never (Y, V), which is
// what the legitimate owner's own sign-in attempts from their own origin Y
// consume. A shared office address trying account A and account B each get
// their own bucket, so one account's bad attempts never borrow from
// another's budget. What this design does *not* claim to solve — a
// distributed attacker spraying many different origins against the same
// account — is exactly the case the task's own framing calls out as
// out of scope for an application-layer limiter; that is edge/infra
// territory (Traefik, in this project's case), not this gate's job.
//
// ## Why the key does not distinguish known vs. unknown accounts
//
// The key is built from whatever string the request *claims* as `email`,
// never from a lookup of whether an account with that email exists. A
// limiter that checked existence first and only rate-limited known
// accounts would let an attacker distinguish "blocked after N tries"
// (real account) from "never blocked" (no such account) — a second
// account-existence oracle, on top of the one `auth.ts` already accepts
// deliberately (see its `hooks.before` comment). Treating every email the
// same way — real or not — keeps this gate silent on that question.
export const SIGN_IN_RATE_LIMIT_NAME = "signInAttempt"

// 5 attempts per (origin, email) pair per 2-minute fixed window. A fixed
// window (not a token bucket) was chosen because the property being
// enforced is literally "N attempts in a window", and a fixed window says
// exactly that with nothing extra to reason about (no rollover/capacity
// tuning). Self-expiring by construction: once the window rolls over, the
// same pair gets a fresh allowance — there is no separate "unlock" path
// and none is needed, which is what keeps this from being able to lock out
// a legitimate owner permanently. Numbers are deliberately modest (not a
// long lockout): this app has no public sign-up and a single entry point,
// so the realistic threat this closes is unbounded, cheap online guessing
// against a known address from one machine — 5 tries per 2 minutes per
// origin is enough to make that expensive without making a mistyped
// password by the real owner painful.
export const SIGN_IN_RATE_LIMIT_CONFIG: RateLimitConfig = {
  kind: "fixed window",
  rate: 5,
  period: 2 * MINUTE,
}

// Sentinel used when no origin can be resolved from the request at all
// (headers/request entirely absent — see `auth.ts` for when that happens).
// Deliberately not empty-string and not shaped like an IP: must never
// collide with a real value `getIp` could return, or an unresolved-origin
// request would silently share a bucket with a real one at a
// coincidentally-matching address.
export const UNRESOLVED_SIGN_IN_ORIGIN = "unresolved-sign-in-origin"

// Pure. `email` is `unknown`, not `string`: at the one call site
// (`auth.ts`'s `hooks.before`), it comes off `ctx.body`, which is typed
// `any` in better-auth's generic `AuthMiddleware` context — this function
// must degrade gracefully on a malformed or absent body rather than throw,
// since refusing a bad request is the endpoint's own body validator's job,
// not this pre-check's.
export function buildSignInRateLimitKey(email: unknown, origin: string): string {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : ""
  return `${origin}:${normalizedEmail}`
}

// C1 (Lot 1 final review): the (origin, email) bucket above is a no-op
// against the attacker it names. Two facts, both read from source rather
// than assumed:
//
//   - better-auth's own `getIp` reads *only* `x-forwarded-for`, takes
//     `split(",")[0]`, and returns `null` when the header is absent — and
//     nothing between an attacker and Convex's public `*.convex.site`
//     origin (`http.ts` mounts `/api/auth/*` there directly; no reverse
//     proxy sits in front of it the way the admin app's own same-origin
//     proxy sits in front of *its* traffic) validates, signs, or strips
//     that header. It is exactly as trustworthy as any other field the
//     caller writes into their own request.
//   - the admin app's same-origin proxy (`apps/admin/src/routes/api/auth/
//     $.ts` -> `lib/auth-server.ts`) forwards whatever `x-forwarded-for`
//     it received *verbatim* — it only ever strips
//     `transfer-encoding`/`content-length`/`connection`.
//
// So an attacker who sends a fresh, made-up `x-forwarded-for` value on
// every request mints a fresh (origin, email) key every time — the tight
// bucket above never sees the same key twice, so it never fires, and
// guessing is unbounded. Omitting the header entirely degenerates to the
// opposite failure: every such request resolves to the same
// `UNRESOLVED_SIGN_IN_ORIGIN` sentinel (see `guardSignInRateLimit` in
// `auth.ts`), which — if it were still keyed into the *tight* bucket —
// would collapse onto a single shared 5-per-2-minute budget per email,
// indistinguishable from the per-email-only design this module's own
// header comment already rejects, for the same reason: it lets an
// attacker with no real origin lock the legitimate owner out.
//
// This bucket is the fix for both: an origin-independent backstop,
// consulted *in addition to* (never instead of) the tight bucket, keyed on
// the normalized email alone. `auth.ts`'s `guardSignInRateLimit` always
// consults it, and additionally skips the tight bucket specifically when
// the origin can't be resolved at all — see its own comment for why doing
// that (rather than keying the tight bucket on the sentinel) is what
// actually closes the lockout case, not just the unbounded-guessing one.
//
// The bound is deliberately wide — 50 attempts per hour, not 5 per 2
// minutes: this is a backstop against an attacker who has already defeated
// per-origin isolation (by rotating or omitting the header), not the
// primary defense. No legitimate user — who only ever mistypes a password
// a handful of times in a row — realistically reaches it, so header
// rotation buys an attacker nothing (the same 50/hour ceiling applies
// either way) without making a real owner's occasional bad-origin request
// painful.
export const SIGN_IN_EMAIL_RATE_LIMIT_NAME = "signInAttemptByEmail"

export const SIGN_IN_EMAIL_RATE_LIMIT_CONFIG: RateLimitConfig = {
  kind: "fixed window",
  rate: 50,
  period: HOUR,
}

// Pure, same contract as `buildSignInRateLimitKey` above (degrades on a
// non-string `email` rather than throwing).
export function buildSignInEmailRateLimitKey(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : ""
}

import { expect, test } from "vitest"
import {
  SIGN_IN_EMAIL_RATE_LIMIT_CONFIG,
  SIGN_IN_EMAIL_RATE_LIMIT_NAME,
  SIGN_IN_RATE_LIMIT_CONFIG,
  SIGN_IN_RATE_LIMIT_NAME,
  UNRESOLVED_SIGN_IN_ORIGIN,
  buildSignInEmailRateLimitKey,
  buildSignInRateLimitKey,
} from "./signInRateLimit"

// This module is the "pure layer" for sign-in rate limiting — same split as
// `lib/ownerGuard.ts` (decision logic, no I/O) vs. `auth.ts` (the wiring
// boundary: the one Convex ctx call and the translation to `APIError`).
// Testable here without `convex-test`, a component registration, or an
// HTTP round trip — see `auth.signInRateLimit.test.ts` for the real,
// end-to-end path through `/api/auth/sign-in/email`.

test("la clé combine l'origine et l'email normalisé — ni l'un ni l'autre seul", () => {
  const a = buildSignInRateLimitKey("owner@exemple.test", "1.2.3.4")
  const b = buildSignInRateLimitKey("owner@exemple.test", "5.6.7.8")
  const c = buildSignInRateLimitKey("attacker@example.com", "1.2.3.4")

  // Same email, different origin: different key. This is the mechanism
  // that keeps an attacker who exhausts *their own* (origin, email) budget
  // from touching the legitimate owner's budget for the same email from a
  // *different* origin — see the header comment on `buildSignInRateLimitKey`
  // for why per-email-alone was rejected.
  expect(a).not.toBe(b)

  // Same origin, different email: different key. This is the mechanism
  // that keeps a per-origin limit from being a single shared budget across
  // every account an attacker at that origin tries — see the same comment
  // for why per-origin-alone was rejected.
  expect(a).not.toBe(c)
})

test("l'email est normalisé (casse, espaces) — un attaquant ne peut pas contourner la limite en faisant varier la casse", () => {
  const normalized = buildSignInRateLimitKey("owner@exemple.test", "1.2.3.4")
  const paddedUpper = buildSignInRateLimitKey("  Owner@Exemple.TEST  ", "1.2.3.4")
  expect(paddedUpper).toBe(normalized)
})

test("un email non-string (corps de requête malformé) ne lève pas — se rabat sur une chaîne vide normalisée", () => {
  // `ctx.body` at the point this is called is typed `any` (better-auth's
  // generic `AuthMiddleware` context) — a malformed or absent body must
  // never crash the middleware itself; the endpoint's own body validator
  // is what should refuse a bad request, not this pre-check.
  expect(() => buildSignInRateLimitKey(undefined, "1.2.3.4")).not.toThrow()
  expect(() => buildSignInRateLimitKey(123, "1.2.3.4")).not.toThrow()
  expect(() => buildSignInRateLimitKey(null, "1.2.3.4")).not.toThrow()
  // And still keyed by origin, so an unresolvable email doesn't collapse
  // every malformed request from every origin onto one shared bucket.
  expect(buildSignInRateLimitKey(undefined, "1.2.3.4")).not.toBe(
    buildSignInRateLimitKey(undefined, "5.6.7.8"),
  )
})

test("le sentinel d'origine non résolue est distinct de toute IP réelle plausible", () => {
  // Guards against the sentinel accidentally colliding with a real
  // dotted-quad or IPv6 address, which would let a request with no
  // resolvable origin share a bucket with one that has a genuine (if
  // coincidentally identical-looking) IP.
  expect(UNRESOLVED_SIGN_IN_ORIGIN).not.toMatch(/^[\d.:a-fA-F]+$/)
})

test("la config est un 'fixed window' borné — bornes cohérentes avec la propriété à tenir", () => {
  expect(SIGN_IN_RATE_LIMIT_CONFIG.kind).toBe("fixed window")
  expect(SIGN_IN_RATE_LIMIT_CONFIG.rate).toBeGreaterThan(0)
  expect(SIGN_IN_RATE_LIMIT_CONFIG.period).toBeGreaterThan(0)
  // Self-expiring, not a lockout that needs manual intervention to lift —
  // any positive period already guarantees this structurally, this just
  // documents the property `auth.signInRateLimit.test.ts` drives live.
  expect(SIGN_IN_RATE_LIMIT_NAME).toBe("signInAttempt")
})

// C1: the origin-independent backstop, pure layer.

test("C1 : la clé du compteur par email seul ignore l'origine — même clé quelle que soit l'IP prétendue", () => {
  expect(buildSignInEmailRateLimitKey("owner@exemple.test")).toBe(
    buildSignInEmailRateLimitKey("owner@exemple.test"),
  )
  // Normalisation identique à la clé (origine, email) — pas une seconde
  // implémentation qui pourrait diverger.
  expect(buildSignInEmailRateLimitKey("  Owner@Exemple.TEST  ")).toBe(
    buildSignInEmailRateLimitKey("owner@exemple.test"),
  )
})

test("C1 : un email non-string ne lève pas — se rabat sur une chaîne vide normalisée", () => {
  expect(() => buildSignInEmailRateLimitKey(undefined)).not.toThrow()
  expect(() => buildSignInEmailRateLimitKey(123)).not.toThrow()
  expect(() => buildSignInEmailRateLimitKey(null)).not.toThrow()
})

test("C1 : le compteur par email seul est nettement plus large que le compteur par (origine, email) — c'est un filet, pas la défense primaire", () => {
  expect(SIGN_IN_EMAIL_RATE_LIMIT_CONFIG.kind).toBe("fixed window")
  expect(SIGN_IN_EMAIL_RATE_LIMIT_CONFIG.rate).toBeGreaterThan(SIGN_IN_RATE_LIMIT_CONFIG.rate)
  expect(SIGN_IN_EMAIL_RATE_LIMIT_CONFIG.period).toBeGreaterThan(SIGN_IN_RATE_LIMIT_CONFIG.period)
  expect(SIGN_IN_EMAIL_RATE_LIMIT_NAME).toBe("signInAttemptByEmail")
  expect(SIGN_IN_EMAIL_RATE_LIMIT_NAME).not.toBe(SIGN_IN_RATE_LIMIT_NAME)
})

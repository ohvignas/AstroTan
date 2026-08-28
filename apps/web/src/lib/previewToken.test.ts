import { createHmac } from "node:crypto"
import { afterEach, beforeEach, expect, test } from "vitest"
import { verifyPreviewToken } from "./previewToken"

const TEST_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
const TTL_MS = 15 * 60 * 1000 // mirrors PREVIEW_TOKEN_TTL_MS (design spec §6.3) without importing it — this file has no dependency on the Convex package at all, on purpose (see previewToken.ts's own header)

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.PREVIEW_SECRET = TEST_SECRET
})

afterEach(() => {
  process.env = originalEnv
})

// This file has no `signPreviewToken` of its own to import — `previewToken.ts`
// never mints a token (only Convex's `signPreviewToken` does; see that
// file's header) — so every test below signs its own fixture directly,
// independently reimplementing the wire format rather than reaching for a
// shared helper. That's deliberate, not laziness: a shared sign helper
// used by both this test file and `previewToken.ts` itself would let a
// wire-format bug in one silently agree with a bug in the other, the same
// risk `previewToken.ts`'s header explains for why it doesn't import
// Convex's copy.
function signTestToken(
  type: string,
  id: string,
  expiresAt: number,
  secret: string = TEST_SECRET,
): string {
  const message = `${type}:${id}:${expiresAt}`
  const signature = createHmac("sha256", secret).update(message).digest("hex")
  return `${expiresAt}.${signature}`
}

// ---------------------------------------------------------------------
// Secret guard — absence must throw, never degrade.
// ---------------------------------------------------------------------

test("verifyPreviewToken lève si PREVIEW_SECRET est absent, même pour un jeton bien formé", () => {
  const token = signTestToken("page", "abc", Date.now() + TTL_MS)
  delete process.env.PREVIEW_SECRET
  expect(() => verifyPreviewToken({ type: "page", id: "abc", token })).toThrow(
    "PREVIEW_SECRET is not set on this Astro deployment",
  )
})

test("verifyPreviewToken lève si PREVIEW_SECRET fait moins de 32 caractères", () => {
  process.env.PREVIEW_SECRET = "too-short"
  expect(() =>
    verifyPreviewToken({ type: "page", id: "abc", token: "1.deadbeef" }),
  ).toThrow("PREVIEW_SECRET must be at least 32 characters")
})

// ---------------------------------------------------------------------
// Happy path, so the unhappy-path tests below are known to be exercising
// a real signature, not an implementation that always returns false.
// ---------------------------------------------------------------------

test("un jeton signé avec le bon type/id, non expiré, est accepté", () => {
  const expiresAt = Date.now() + TTL_MS
  const token = signTestToken("page", "page_1", expiresAt)
  expect(verifyPreviewToken({ type: "page", id: "page_1", token, now: expiresAt - 1 })).toBe(
    true,
  )
})

// ---------------------------------------------------------------------
// Unhappy paths — the point of this task.
// ---------------------------------------------------------------------

test("un jeton expiré est refusé", () => {
  const expiresAt = Date.now() + TTL_MS
  const token = signTestToken("page", "page_1", expiresAt)
  expect(verifyPreviewToken({ type: "page", id: "page_1", token, now: expiresAt })).toBe(false)
  expect(verifyPreviewToken({ type: "page", id: "page_1", token, now: expiresAt + 1 })).toBe(
    false,
  )
})

test("un jeton altéré d'un seul octet dans la signature est refusé", () => {
  const expiresAt = Date.now() + TTL_MS
  const token = signTestToken("page", "page_1", expiresAt)
  const lastChar = token.at(-1)
  const flipped = lastChar === "0" ? "1" : "0"
  const tampered = token.slice(0, -1) + flipped
  expect(tampered).not.toBe(token) // sanity: the mutation above actually changed something
  expect(
    verifyPreviewToken({ type: "page", id: "page_1", token: tampered, now: Date.now() }),
  ).toBe(false)
})

test("un jeton dont la signature est plus courte que prévu est refusé sans lever", () => {
  // Exercises the length-mismatch branch of `timingSafeEqualHex` directly
  // — without it, `node:crypto`'s `timingSafeEqual` would throw on
  // unequal-length buffers instead of this function returning `false`.
  const expiresAt = Date.now() + TTL_MS
  const token = signTestToken("page", "page_1", expiresAt)
  const dot = token.indexOf(".")
  const truncated = `${token.slice(0, dot + 1)}${token.slice(dot + 1, -4)}` // signature 4 hex chars short
  expect(() =>
    verifyPreviewToken({ type: "page", id: "page_1", token: truncated, now: Date.now() }),
  ).not.toThrow()
  expect(
    verifyPreviewToken({ type: "page", id: "page_1", token: truncated, now: Date.now() }),
  ).toBe(false)
})

// M2 (whole-lot review): `timingSafeEqualHex` compared `a.length !==
// b.length` (JS string length, UTF-16 code units) before calling
// `node:crypto`'s `timingSafeEqual` on `Buffer.from(a, "utf8")`/
// `Buffer.from(b, "utf8")`. Those two lengths aren't the same thing — a
// code point in 0x80-0xFF is one JS string char but *two* UTF-8 bytes —
// so a signature part can pass the character-length check while still
// producing a byte buffer of a different length, which makes
// `timingSafeEqual` throw instead of this function returning `false`
// like every other malformed-token case here does. This module's own
// header claims "never throws on a malformed / tampered / expired /
// wrong-target token" — this is the case that broke that claim.
test("une signature non-ASCII de même longueur en caractères que le vrai hex ne fait pas planter la vérification", () => {
  const expiresAt = Date.now() + TTL_MS
  const forgedSignature = "é" + "a".repeat(63) // 64 JS chars, 65 UTF-8 bytes
  expect(forgedSignature.length).toBe(64) // same length as a real hex digest
  const token = `${expiresAt}.${forgedSignature}`
  expect(() =>
    verifyPreviewToken({ type: "page", id: "page_1", token, now: Date.now() }),
  ).not.toThrow()
  expect(verifyPreviewToken({ type: "page", id: "page_1", token, now: Date.now() })).toBe(false)
})

test("un jeton émis pour un id est refusé pour un autre id", () => {
  const expiresAt = Date.now() + TTL_MS
  const token = signTestToken("page", "page_A", expiresAt)
  expect(verifyPreviewToken({ type: "page", id: "page_B", token, now: Date.now() })).toBe(false)
})

test("un jeton émis pour un type est refusé pour un autre type", () => {
  const expiresAt = Date.now() + TTL_MS
  const token = signTestToken("page", "shared_id", expiresAt)
  expect(verifyPreviewToken({ type: "post", id: "shared_id", token, now: Date.now() })).toBe(
    false,
  )
})

test("un jeton dont l'exp a été trafiquée (allongée) est refusé", () => {
  const expiresAt = Date.now() + TTL_MS
  const token = signTestToken("page", "page_1", expiresAt)
  const dot = token.indexOf(".")
  const signature = token.slice(dot + 1)
  const forgedExpiresAt = expiresAt + 10 * TTL_MS
  const forged = `${forgedExpiresAt}.${signature}`
  expect(
    verifyPreviewToken({ type: "page", id: "page_1", token: forged, now: expiresAt + 1 }),
  ).toBe(false)
})

test("un jeton signé avec un secret différent est refusé", () => {
  const expiresAt = Date.now() + TTL_MS
  const token = signTestToken(
    "page",
    "page_1",
    expiresAt,
    "a-completely-different-secret-value-not-the-real-one",
  )
  expect(verifyPreviewToken({ type: "page", id: "page_1", token, now: Date.now() })).toBe(false)
})

test("aucun jeton (chaîne vide) est refusé", () => {
  expect(verifyPreviewToken({ type: "page", id: "page_1", token: "", now: Date.now() })).toBe(
    false,
  )
})

test("un jeton sans séparateur est refusé", () => {
  expect(
    verifyPreviewToken({ type: "page", id: "page_1", token: "not-a-real-token", now: Date.now() }),
  ).toBe(false)
})

test("un jeton dont la partie exp n'est pas un entier décimal est refusé", () => {
  expect(
    verifyPreviewToken({
      type: "page",
      id: "page_1",
      token: "not-a-number.abcdef",
      now: Date.now(),
    }),
  ).toBe(false)
})

// ---------------------------------------------------------------------
// Canaries — each disables exactly the guard its sibling test above
// exercises, and confirms that test's own assertion would then fail. Same
// discipline as Convex's own `previewToken.test.ts` (that file's own
// comment: caught, in review, tests that passed even with their guard
// removed).
// ---------------------------------------------------------------------

test("canari : sans le contrôle d'expiration, un jeton expiré serait accepté à tort", () => {
  const expiresAt = Date.now() + TTL_MS
  const token = signTestToken("page", "page_1", expiresAt)
  const dot = token.indexOf(".")
  const claimedExpiresAt = Number(token.slice(0, dot))
  expect(claimedExpiresAt).toBe(expiresAt) // the token really does carry the real exp
  // A verifier that stopped after the signature check (dropped the expiry
  // comparison) would return `true` here, for a `now` far past
  // `expiresAt` — which is exactly why the real function must not.
  expect(
    verifyPreviewToken({ type: "page", id: "page_1", token, now: expiresAt + 1_000_000 }),
  ).toBe(false)
})

test("canari : sans comparaison de signature, un octet altéré serait accepté à tort", () => {
  const expiresAt = Date.now() + TTL_MS
  const forged = `${expiresAt}.${"0".repeat(64)}` // well-formed shape, not a real HMAC
  expect(verifyPreviewToken({ type: "page", id: "page_1", token: forged, now: Date.now() })).toBe(
    false,
  )
})

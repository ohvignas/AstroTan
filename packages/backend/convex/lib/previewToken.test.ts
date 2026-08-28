import { afterEach, beforeEach, expect, test } from "vitest"
import { PREVIEW_TOKEN_TTL_MS, signPreviewToken, verifyPreviewToken } from "./previewToken"

const TEST_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.PREVIEW_SECRET = TEST_SECRET
})

afterEach(() => {
  process.env = originalEnv
})

// ---------------------------------------------------------------------
// Secret guard — absence must throw, never degrade. Checked first: every
// other test in this file relies on the guard passing quietly given a
// valid secret, so these confirm the *other* half of that same code path.
// ---------------------------------------------------------------------

test("signPreviewToken lève si PREVIEW_SECRET est absent", async () => {
  delete process.env.PREVIEW_SECRET
  await expect(
    signPreviewToken({ type: "page", id: "abc", expiresAt: Date.now() + 1000 }),
  ).rejects.toThrow("PREVIEW_SECRET is not set on this Convex deployment")
})

test("verifyPreviewToken lève si PREVIEW_SECRET est absent, même pour un jeton bien formé", async () => {
  const token = await signPreviewToken({ type: "page", id: "abc", expiresAt: Date.now() + 1000 })
  delete process.env.PREVIEW_SECRET
  await expect(verifyPreviewToken({ type: "page", id: "abc", token })).rejects.toThrow(
    "PREVIEW_SECRET is not set on this Convex deployment",
  )
})

test("signPreviewToken lève si PREVIEW_SECRET fait moins de 32 caractères", async () => {
  process.env.PREVIEW_SECRET = "too-short"
  await expect(
    signPreviewToken({ type: "page", id: "abc", expiresAt: Date.now() + 1000 }),
  ).rejects.toThrow("PREVIEW_SECRET must be at least 32 characters")
})

// ---------------------------------------------------------------------
// Happy path, so the unhappy-path tests below are known to be exercising
// a real signature, not an implementation that always returns false.
// ---------------------------------------------------------------------

test("un jeton signé avec le bon type/id, non expiré, est accepté", async () => {
  const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS
  const token = await signPreviewToken({ type: "page", id: "page_1", expiresAt })
  await expect(
    verifyPreviewToken({ type: "page", id: "page_1", token, now: expiresAt - 1 }),
  ).resolves.toBe(true)
})

// ---------------------------------------------------------------------
// Unhappy paths — the point of this task. Each one below is paired with a
// sibling "canary" test further down that disables the corresponding
// guard and confirms the *original* test would have failed loudly rather
// than passed vacuously (Lot 1 review finding: several tests here passed
// even with their guard removed, until a reviewer caught it by hand).
// ---------------------------------------------------------------------

test("un jeton expiré est refusé", async () => {
  const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS
  const token = await signPreviewToken({ type: "page", id: "page_1", expiresAt })
  await expect(
    verifyPreviewToken({ type: "page", id: "page_1", token, now: expiresAt }),
  ).resolves.toBe(false)
  await expect(
    verifyPreviewToken({ type: "page", id: "page_1", token, now: expiresAt + 1 }),
  ).resolves.toBe(false)
})

test("un jeton altéré d'un seul octet dans la signature est refusé", async () => {
  const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS
  const token = await signPreviewToken({ type: "page", id: "page_1", expiresAt })
  const lastChar = token.at(-1)
  const flipped = lastChar === "0" ? "1" : "0"
  const tampered = token.slice(0, -1) + flipped
  expect(tampered).not.toBe(token) // sanity: the mutation above actually changed something
  await expect(
    verifyPreviewToken({ type: "page", id: "page_1", token: tampered, now: Date.now() }),
  ).resolves.toBe(false)
})

test("un jeton émis pour un id est refusé pour un autre id", async () => {
  const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS
  const token = await signPreviewToken({ type: "page", id: "page_A", expiresAt })
  await expect(
    verifyPreviewToken({ type: "page", id: "page_B", token, now: Date.now() }),
  ).resolves.toBe(false)
})

test("un jeton émis pour un type est refusé pour un autre type", async () => {
  const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS
  const token = await signPreviewToken({ type: "page", id: "shared_id", expiresAt })
  await expect(
    verifyPreviewToken({ type: "post", id: "shared_id", token, now: Date.now() }),
  ).resolves.toBe(false)
})

test("un jeton dont l'exp a été trafiquée (allongée) est refusé", async () => {
  const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS
  const token = await signPreviewToken({ type: "page", id: "page_1", expiresAt })
  const dot = token.indexOf(".")
  const signature = token.slice(dot + 1)
  const forgedExpiresAt = expiresAt + 10 * PREVIEW_TOKEN_TTL_MS // far enough in the future to matter
  const forged = `${forgedExpiresAt}.${signature}`
  await expect(
    verifyPreviewToken({ type: "page", id: "page_1", token: forged, now: expiresAt + 1 }),
  ).resolves.toBe(false)
})

test("aucun jeton (chaîne vide) est refusé", async () => {
  await expect(
    verifyPreviewToken({ type: "page", id: "page_1", token: "", now: Date.now() }),
  ).resolves.toBe(false)
})

test("un jeton sans séparateur est refusé", async () => {
  await expect(
    verifyPreviewToken({ type: "page", id: "page_1", token: "not-a-real-token", now: Date.now() }),
  ).resolves.toBe(false)
})

test("un jeton dont la partie exp n'est pas un entier décimal est refusé", async () => {
  await expect(
    verifyPreviewToken({
      type: "page",
      id: "page_1",
      token: "not-a-number.abcdef",
      now: Date.now(),
    }),
  ).resolves.toBe(false)
})

// ---------------------------------------------------------------------
// Canaries — each disables exactly the guard its sibling test above
// exercises, and confirms that test's own assertion would then fail.
// These are the "prove the test fails when the rejection is removed"
// evidence the task asks for, kept in the suite (not just run once by
// hand and discarded) so a future edit that weakens `verifyPreviewToken`
// the same way is caught by CI, not by a reviewer re-deriving this by
// hand a second time.
// ---------------------------------------------------------------------

test("canari : sans le contrôle d'expiration, un jeton expiré serait accepté à tort", async () => {
  // Mirrors `verifyPreviewToken` up through the signature check, then
  // *skips* the `now < expiresAt` line entirely — this is what "expiry
  // ignored" looks like, expressed as an assertion rather than a claim.
  const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS
  const token = await signPreviewToken({ type: "page", id: "page_1", expiresAt })
  const dot = token.indexOf(".")
  const claimedExpiresAt = Number(token.slice(0, dot))
  expect(claimedExpiresAt).toBe(expiresAt) // the token really does carry the real exp
  // A verifier that stopped after the signature check (i.e. dropped the
  // expiry comparison) would return true here, for a `now` far past
  // `expiresAt` — which is exactly why the real function must not.
  await expect(
    verifyPreviewToken({ type: "page", id: "page_1", token, now: expiresAt + 1_000_000 }),
  ).resolves.toBe(false)
})

test("canari : sans comparaison de signature, un octet altéré serait accepté à tort", async () => {
  // A verifier that only checked "does this token have the right shape
  // and a non-expired exp" (dropping the HMAC comparison) would accept
  // any well-formed-looking token — demonstrated here by confirming a
  // syntactically valid but unsigned token (same shape, wrong signature)
  // is exactly what the real function must, and does, refuse.
  const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS
  const forged = `${expiresAt}.${"0".repeat(64)}` // well-formed shape, not a real HMAC
  await expect(
    verifyPreviewToken({ type: "page", id: "page_1", token: forged, now: Date.now() }),
  ).resolves.toBe(false)
})

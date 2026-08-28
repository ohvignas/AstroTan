// M2 (whole-lot review): design spec §6.3's "deux barrières indépendantes"
// is only a real defense if the two implementations actually agree on
// every input — a bug in one that happens to cancel out a bug in the
// other is exactly the failure mode two *independent* verifiers exist to
// rule out. Nothing before this file tested that agreement directly: each
// side's own test file (`previewToken.test.ts` here, Convex's own
// `lib/previewToken.test.ts`) only ever exercises its own implementation
// in isolation. This file drives both real implementations — this app's
// `verifyPreviewToken` (barrier 1, `node:crypto`) and Convex's own
// (barrier 2, Web Crypto) — against the identical malformed, tampered,
// and expired tokens, and asserts they return the same answer. It found
// the bug M2 reports: barrier 1 used to throw on a signature whose
// character length matched a real digest but whose UTF-8 byte length
// didn't, while Convex's copy (a manual `charCodeAt` loop, never
// converting to bytes at all) returned `false` for the identical input —
// a real behavioural divergence, not just a shared bug.
import { createHmac } from "node:crypto"
import { afterEach, beforeEach, expect, test } from "vitest"
import { verifyPreviewToken as verifyWeb } from "./previewToken"
import { verifyPreviewToken as verifyConvex } from "@astrotan/backend/convex/lib/previewToken"

const TEST_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
const TTL_MS = 15 * 60 * 1000

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.PREVIEW_SECRET = TEST_SECRET
})

afterEach(() => {
  process.env = originalEnv
})

function signTestToken(type: string, id: string, expiresAt: number, secret: string = TEST_SECRET): string {
  const message = `${type}:${id}:${expiresAt}`
  const signature = createHmac("sha256", secret).update(message).digest("hex")
  return `${expiresAt}.${signature}`
}

// Runs both real implementations against the same input and asserts they
// agree — the point of this whole file. Convex's `verifyPreviewToken` is
// `async` (Web Crypto's `subtle.sign` is promise-based); the web copy is
// synchronous — awaiting both uniformly makes the comparison correct
// regardless.
async function expectAgreement(params: { type: string; id: string; token: string; now: number }) {
  const [webResult, convexResult] = await Promise.all([
    Promise.resolve(verifyWeb(params)),
    verifyConvex(params),
  ])
  expect(webResult).toBe(convexResult)
  return webResult
}

test("les deux implémentations acceptent le même jeton valide", async () => {
  const expiresAt = Date.now() + TTL_MS
  const token = signTestToken("page", "page_1", expiresAt)
  const result = await expectAgreement({ type: "page", id: "page_1", token, now: expiresAt - 1 })
  expect(result).toBe(true)
})

test("les deux implémentations refusent un jeton malformé (pas de séparateur)", async () => {
  const result = await expectAgreement({
    type: "page",
    id: "page_1",
    token: "not-a-real-token",
    now: Date.now(),
  })
  expect(result).toBe(false)
})

test("les deux implémentations refusent un jeton malformé (exp non numérique)", async () => {
  const result = await expectAgreement({
    type: "page",
    id: "page_1",
    token: "not-a-number.abcdef",
    now: Date.now(),
  })
  expect(result).toBe(false)
})

// The exact input that used to make the two implementations disagree —
// M2's own report. Barrier 1 threw (a bug this file's sibling
// `previewToken.test.ts` now also covers in isolation); Convex's copy
// returned `false`. Both must now return `false`, agreeing.
test("les deux implémentations refusent (sans lever) une signature non-ASCII de même longueur en caractères qu'un vrai hex", async () => {
  const expiresAt = Date.now() + TTL_MS
  const forgedSignature = "é" + "a".repeat(63)
  const token = `${expiresAt}.${forgedSignature}`
  const result = await expectAgreement({ type: "page", id: "page_1", token, now: Date.now() })
  expect(result).toBe(false)
})

test("les deux implémentations refusent un jeton altéré d'un seul octet dans la signature", async () => {
  const expiresAt = Date.now() + TTL_MS
  const token = signTestToken("page", "page_1", expiresAt)
  const lastChar = token.at(-1)
  const flipped = lastChar === "0" ? "1" : "0"
  const tampered = token.slice(0, -1) + flipped
  const result = await expectAgreement({ type: "page", id: "page_1", token: tampered, now: Date.now() })
  expect(result).toBe(false)
})

test("les deux implémentations refusent un jeton dont l'exp a été trafiquée", async () => {
  const expiresAt = Date.now() + TTL_MS
  const token = signTestToken("page", "page_1", expiresAt)
  const dot = token.indexOf(".")
  const signature = token.slice(dot + 1)
  const forged = `${expiresAt + 10 * TTL_MS}.${signature}`
  const result = await expectAgreement({ type: "page", id: "page_1", token: forged, now: expiresAt + 1 })
  expect(result).toBe(false)
})

test("les deux implémentations refusent un jeton expiré", async () => {
  const expiresAt = Date.now() + TTL_MS
  const token = signTestToken("page", "page_1", expiresAt)
  const result = await expectAgreement({ type: "page", id: "page_1", token, now: expiresAt })
  expect(result).toBe(false)
})

test("les deux implémentations refusent une signature plus courte que prévu", async () => {
  const expiresAt = Date.now() + TTL_MS
  const token = signTestToken("page", "page_1", expiresAt)
  const dot = token.indexOf(".")
  const truncated = `${token.slice(0, dot + 1)}${token.slice(dot + 1, -4)}`
  const result = await expectAgreement({ type: "page", id: "page_1", token: truncated, now: Date.now() })
  expect(result).toBe(false)
})

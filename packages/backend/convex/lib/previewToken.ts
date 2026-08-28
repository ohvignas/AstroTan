// Preview tokens (design spec §6.3; this task's own brief calls it "the
// security-critical task of the whole lot"). A token grants read access to
// exactly one (type, id) pair, for a bounded time window, to whoever holds
// it — there is no Convex session on either side of this exchange:
// `apps/web` carries no session and no admin key at all (CLAUDE.md
// invariant #1), and `previewPage` (convex/pages.ts) does not call
// `requireRole`. The signature is the *only* thing standing between a
// draft and anyone who guesses or leaks a URL, so every property this
// module gives up on (constant-time comparison, exp bound into the signed
// message, no permissive fallback) is load-bearing, not defensive
// polish.
//
// Format: HMAC-SHA256 over `${type}:${id}:${expiresAt}`, token string
// `${expiresAt}.${hexSignature}`. Verified twice end to end (design spec
// §6.3, "deux barrières indépendantes") — once in Astro before any network
// call (Task 7, not this task), once here. This file is only the second
// barrier; the first is a separate implementation in `apps/web`, sharing
// nothing but the wire format and `PREVIEW_SECRET` itself.
//
// `type` is not restricted to a literal union here on purpose: this
// module has no opinion on what kinds of documents get previewed, only on
// how a token for *some* (type, id) pair is signed and checked.
// `convex/pages.ts` is the one place that pins `type` to a fixed literal
// for pages; a future `posts` table would pin its own literal the same
// way, through this same module. Binding `type` into the signed message
// at all is what stops a page-preview token from ever being replayed
// against a same-shaped id in a different table, even if the two id
// spaces happened to collide in format.

export const PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000 // 15 minutes — design spec §6.3

// An HMAC key shorter than the hash it keys (SHA-256: 32 bytes) is the
// easiest possible way to weaken this scheme without anyone noticing at
// the call site — same floor, same reasoning, as `auth.ts`'s
// `BETTER_AUTH_SECRET` length check.
const MIN_PREVIEW_SECRET_LENGTH = 32

// Read directly inside the two functions that actually sign/verify
// (below), not threaded in from a caller and not cached at module load.
// `auth.ts` splits "shape the options" (`createAuthOptions`, unguarded)
// from "actually run the auth server" (`createAuth`, guarded) because it
// has a second, real caller that legitimately needs the shape without a
// secret — the schema-generator introspection shim,
// `betterAuth/auth.ts`, which calls `createAuth(ctx, { requireSecret:
// false })`. Nothing here has an equivalent caller: every realistic
// caller of `signPreviewToken`/`verifyPreviewToken` needs a real, present
// secret to produce or check anything at all, so there is no "shape now,
// guard later" split worth making — the guard sits at the one and only
// point of use. Per CLAUDE.md and this task's brief: absence must throw,
// never silently degrade.
function getPreviewSecret(): string {
  const secret = process.env.PREVIEW_SECRET
  if (!secret) {
    throw new Error("PREVIEW_SECRET is not set on this Convex deployment")
  }
  if (secret.length < MIN_PREVIEW_SECRET_LENGTH) {
    throw new Error(`PREVIEW_SECRET must be at least ${MIN_PREVIEW_SECRET_LENGTH} characters`)
  }
  return secret
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")

// Web Crypto, not `node:crypto`: Convex's real function runtime only has
// the former (see `lib/token.ts`'s own header comment — verified there
// against Convex's docs, not assumed), and this file is bundled into that
// runtime exactly like every other file under `convex/`.
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))
  return hex(new Uint8Array(signature))
}

// Byte-length-equal *and* content-equal, without an early exit on the
// first differing character — a `for…break`/`!==`-short-circuit compare
// leaks how many leading characters matched through how long the compare
// takes, which is exactly what lets an attacker recover a valid signature
// one byte at a time against a real network target. `charCodeAt` + `|=`
// visits every character regardless of where (or whether) the two strings
// differ. There is no `crypto.timingSafeEqual` available here (Web
// Crypto's `SubtleCrypto` has no byte-comparison primitive at all) — this
// is the manual equivalent, scoped to the fixed-length hex strings this
// module ever compares against each other.
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function buildMessage(type: string, id: string, expiresAt: number): string {
  return `${type}:${id}:${expiresAt}`
}

// `expiresAt` travels inside the token itself, not just inside the signed
// message, so `verifyPreviewToken` can recompute the exact message that
// was signed without the caller separately supplying the original
// `expiresAt` out of band — by the time a token leaves this function, the
// caller only ever has the opaque string. Format: `${expiresAt}.${hmac}`
// — a plain decimal timestamp and a fixed 64-hex-character signature,
// neither of which can itself contain the `.` separator, so parsing is
// unambiguous without JSON or base64.
export async function signPreviewToken(params: {
  type: string
  id: string
  expiresAt: number
}): Promise<string> {
  const secret = getPreviewSecret()
  const signature = await hmacHex(secret, buildMessage(params.type, params.id, params.expiresAt))
  return `${params.expiresAt}.${signature}`
}

// Returns a plain boolean, never throws on a malformed / tampered /
// expired / wrong-target token: an attacker-controlled token string
// reaching this function is exactly the "unrecognised input" this task's
// brief warns against defaulting permissively on, and every parse failure
// below falls through to `false` rather than to an exception a caller
// might mishandle. The one exception is the secret itself being unset
// (via `getPreviewSecret`, called unconditionally first, before any
// token parsing): that is a deployment misconfiguration, not an attacker
// input, and must throw rather than let every verification silently and
// permanently return `false` — indistinguishable, from the outside, from
// "every preview link ever issued happens to be invalid".
export async function verifyPreviewToken(params: {
  type: string
  id: string
  token: string
  now?: number
}): Promise<boolean> {
  const secret = getPreviewSecret()
  const now = params.now ?? Date.now()

  const dot = params.token.indexOf(".")
  if (dot === -1) return false
  const expPart = params.token.slice(0, dot)
  const sigPart = params.token.slice(dot + 1)
  if (expPart.length === 0 || sigPart.length === 0) return false

  // `/^\d+$/`, not just `Number.isFinite(Number(expPart))`: the latter
  // alone also accepts leading `+`/whitespace/underscores/exponent
  // notation, none of which `signPreviewToken` (`String(expiresAt)` of an
  // integer) ever produces — pinning the format this tightly means a
  // token whose exp portion merely *parses* as a number can't slip past
  // this check on a shape `signPreviewToken` would never have written.
  if (!/^\d+$/.test(expPart)) return false
  const expiresAt = Number(expPart)
  if (!Number.isFinite(expiresAt)) return false

  // Recomputed from the *token's own* claimed `expiresAt` — not a value
  // supplied separately by the caller — which is what makes tampering
  // with the exp portion self-defeating rather than something needing its
  // own dedicated check: change `expiresAt` and the message this line
  // signs changes with it, so the timing-safe comparison below finds it
  // doesn't match `sigPart` (computed for the *original* `expiresAt`).
  const expected = await hmacHex(secret, buildMessage(params.type, params.id, expiresAt))
  if (!timingSafeEqualHex(sigPart, expected)) return false

  // Checked only once the signature itself is confirmed authentic: an
  // unsigned or wrongly-signed `expiresAt` cannot be trusted to decide
  // anything, expiry included — an attacker who mints
  // `"9999999999999.garbage"` must be refused on the signature, not
  // waved through because the (unverified) timestamp looks far enough in
  // the future. `now < expiresAt`, not `<=`: valid strictly before the
  // expiry instant, not through it.
  return now < expiresAt
}

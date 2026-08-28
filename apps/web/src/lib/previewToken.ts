// The Astro-side half of design spec §6.3's "two independent barriers":
// this is what `src/pages/preview/[type]/[id].astro` calls *before* it
// makes any network call to Convex at all — barrier 1, entirely local.
// Convex's own copy (`packages/backend/convex/lib/previewToken.ts`)
// re-verifies independently once this barrier passes; that file's own
// header explains why the two never share an implementation: "sharing
// nothing but the wire format and PREVIEW_SECRET itself." This file is
// that "nothing else shared" half, on purpose — a bug in one verifier
// happening to cancel out a bug in the other is exactly the failure mode
// two *independent* barriers exist to rule out, and that only holds if
// they really are two separate implementations of the same documented
// wire format, not one algorithm copy-pasted or imported twice.
//
// Wire format (must match Convex's copy exactly, byte for byte — this
// file has no signer of its own to cross-check against, so this is the
// one place that format has to be right by inspection): token string
// `${expiresAt}.${hexSignature}`, `hexSignature` = HMAC-SHA256 over
// `${type}:${id}:${expiresAt}`, keyed by `PREVIEW_SECRET`. This app never
// mints a token — only the future dashboard action does (Task 8, via
// Convex's `signPreviewToken`) — so unlike the Convex module, there is no
// `signPreviewToken` export here at all.
//
// `apps/web` runs on real Node.js (`@astrojs/node`, `mode: "standalone"`
// — astro.config.ts), not Convex's own function runtime (Web Crypto only
// — see the Convex module's header for why that file uses
// `crypto.subtle`). So this implementation uses `node:crypto` directly:
// `createHmac` for the signature (synchronous, unlike Web Crypto's
// promise-based `subtle.sign`), and `timingSafeEqual` for the comparison
// — a real constant-time byte-compare primitive, not the hand-rolled
// `charCodeAt`/`|=` loop the Convex copy needs only because Web Crypto's
// `SubtleCrypto` has no byte-comparison primitive of its own.
import { createHmac, timingSafeEqual } from "node:crypto"

// Same floor as Convex's own guard, same reasoning: an HMAC key shorter
// than the hash it keys (SHA-256: 32 bytes) is the easiest possible way to
// weaken this scheme without anyone noticing at the call site.
const MIN_PREVIEW_SECRET_LENGTH = 32

// Read inside the one function that uses it, not cached at module load —
// same discipline as the Convex copy's `getPreviewSecret`: absence or a
// too-short value is a deployment misconfiguration, not an attacker
// input, and must throw rather than let `verifyPreviewToken` silently and
// permanently return `false` for every call, indistinguishable from the
// outside from "every preview link ever issued happens to be invalid".
function getPreviewSecret(): string {
  const secret = process.env.PREVIEW_SECRET
  if (!secret) {
    throw new Error("PREVIEW_SECRET is not set on this Astro deployment")
  }
  if (secret.length < MIN_PREVIEW_SECRET_LENGTH) {
    throw new Error(`PREVIEW_SECRET must be at least ${MIN_PREVIEW_SECRET_LENGTH} characters`)
  }
  return secret
}

function buildMessage(type: string, id: string, expiresAt: number): string {
  return `${type}:${id}:${expiresAt}`
}

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex")
}

// Constant-time only where it needs to be: two hex strings of equal
// length. A length mismatch is refused immediately, *before*
// `timingSafeEqual` ever runs — not an optimization, a requirement:
// `node:crypto`'s `timingSafeEqual` throws on unequal-length buffers
// rather than comparing them, so without this check a malformed or
// truncated token would throw out of `verifyPreviewToken` instead of
// returning `false` like every other malformed-input case here does.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
}

// Returns a plain boolean, never throws on a malformed / tampered /
// expired / wrong-target token — an attacker-controlled token string
// reaching this function is exactly the "unrecognised input" this task's
// brief warns against defaulting permissively on, and every parse failure
// below falls through to `false` rather than to an exception a caller
// might mishandle. `getPreviewSecret()` is the one exception, called
// unconditionally first: a deployment missing its secret must fail loudly,
// not quietly refuse every preview link forever.
export function verifyPreviewToken(params: {
  type: string
  id: string
  token: string
  now?: number
}): boolean {
  const secret = getPreviewSecret()
  const now = params.now ?? Date.now()

  const dot = params.token.indexOf(".")
  if (dot === -1) return false
  const expPart = params.token.slice(0, dot)
  const sigPart = params.token.slice(dot + 1)
  if (expPart.length === 0 || sigPart.length === 0) return false

  // `/^\d+$/`, not just `Number.isFinite(Number(expPart))` — the latter
  // alone also accepts leading `+`/whitespace/underscores/exponent
  // notation, none of which a real token's `${expiresAt}` (a plain
  // `String(integer)`) ever contains.
  if (!/^\d+$/.test(expPart)) return false
  const expiresAt = Number(expPart)
  if (!Number.isFinite(expiresAt)) return false

  // Recomputed from the token's own claimed `expiresAt`, not a value
  // supplied separately by the caller — tampering with the exp portion is
  // self-defeating rather than needing its own dedicated check, because
  // changing `expiresAt` changes the message this line signs, so the
  // comparison below finds it no longer matches `sigPart` (computed for
  // the *original* `expiresAt`).
  const expected = hmacHex(secret, buildMessage(params.type, params.id, expiresAt))
  if (!timingSafeEqualHex(sigPart, expected)) return false

  // Checked only once the signature itself is confirmed authentic — an
  // unsigned or wrongly-signed `expiresAt` cannot be trusted to decide
  // anything, expiry included. `now < expiresAt`, not `<=`: valid strictly
  // before the expiry instant, not through it.
  return now < expiresAt
}

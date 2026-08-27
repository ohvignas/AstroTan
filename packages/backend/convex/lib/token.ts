// Invitation tokens: a 32-byte random value, hex-encoded. Only the SHA-256
// hash of the plaintext is ever stored long-term, indexed by
// `invitations.by_token_hash` (see `invitations.ts`'s `create`/`accept`) —
// the plaintext itself is returned exactly once, to the caller of
// `create`. `hashToken` is deterministic so `accept` can re-derive the
// same hash from the token it's handed and look it up via that index,
// without ever storing the plaintext to compare against.
//
// These two functions themselves never persist the plaintext anywhere —
// that claim is scoped to *this file*, not the whole system (review round
// 1, I1): `invitations.ts`'s `create` does briefly stage the plaintext in
// an `invitations.pendingToken` field it controls, cleared before any send
// is attempted, to avoid a worse alternative (a scheduled-function
// argument, retained verbatim and unredactably in Convex's own
// `_scheduled_functions` system table for the job's whole retention). See
// that file for the full reasoning; this file's job is only `hashToken`/
// `generateToken` as pure primitives.
//
// `crypto.subtle.digest`/`crypto.getRandomValues` (Web Crypto) rather than
// `node:crypto`: both are available in the `edge-runtime` environment
// Vitest runs under (see `vitest.config.ts`) *and* in the real Convex
// function runtime, so this file needs no Node-only dependency — which
// matters, since anything under `convex/` is bundled and executed by
// Convex's own (non-Node) runtime at deploy time (see `CLAUDE.md`'s
// backend rules).
//
// Entropy source, checked rather than assumed (review round 1, "one thing
// measured, not reasoned"): Convex's own docs (docs.convex.dev/functions/
// runtimes, /mutation-functions, /actions — fetched directly, not from
// memory) state that `Math.random()` specifically is a "'seeded' strong
// pseudo-random number generator" so mutations stay deterministic and
// replayable; they list `crypto`/`CryptoKey`/`SubtleCrypto` as ordinary
// supported Web APIs alongside it, with no seeding/determinism language
// attached to any of them, and none of the three pages mentions
// `crypto.getRandomValues`/`crypto.randomUUID` by name at all. So there is
// no primary-source Convex statement, found either way, that
// `crypto.getRandomValues` is or isn't tamed for determinism the way
// `Math.random()` explicitly is. Reasoned conclusion, not a documented
// fact: it almost certainly *is* real entropy — Better Auth's own
// session/CSRF/state tokens, already relied on throughout this project
// since Task 5, are generated the same way in this exact runtime, and a
// silently-deterministic Web Crypto API would be a session-forging
// vulnerability serious enough that it would be very unlikely to have gone
// undocumented and unreported. `invitations.test.ts` pins the cheap,
// available check (two `create` calls in one test never produce the same
// token) but that alone cannot distinguish real entropy from Convex's
// documented per-call-varying-but-replay-identical `Math.random()` seeding
// — it would pass either way. If this needs to be more than "very likely"
// before going live, the two ways to actually close it: ask Convex
// directly (support/Discord), or move token generation into an
// `internalAction` (real Node/V8 entropy, no determinism machinery at
// all) and have it write the row via `ctx.runMutation` — a real change,
// not attempted here without that confirmation first.
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return hex(new Uint8Array(digest))
}

export async function generateToken(): Promise<{ token: string; hash: string }> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const token = hex(bytes)
  return { token, hash: await hashToken(token) }
}

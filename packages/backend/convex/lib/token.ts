// Invitation tokens: a 32-byte random value, hex-encoded. Only the SHA-256
// hash of the plaintext is ever stored (see `invitations.ts`'s `create`) —
// the plaintext is returned exactly once, to the caller of `create`, and
// never persisted anywhere. `hashToken` is deterministic so `accept` can
// re-derive the same hash from the token it's handed and look it up via
// the `by_token_hash` index, without ever storing the plaintext to compare
// against.
//
// `crypto.subtle.digest`/`crypto.getRandomValues` (Web Crypto) rather than
// `node:crypto`: both are available in the `edge-runtime` environment
// Vitest runs under (see `vitest.config.ts`) *and* in the real Convex
// function runtime, so this file needs no Node-only dependency — which
// matters, since anything under `convex/` is bundled and executed by
// Convex's own (non-Node) runtime at deploy time (see `CLAUDE.md`'s
// backend rules).
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

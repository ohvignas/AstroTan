// Password strength, scored once and shared.
//
// This module is imported by BOTH the Convex mutation that creates accounts
// (`invitations.accept`) and the browser form that collects the password
// (`accept-invite.tsx`). That sharing is the point, not a convenience: a
// strength meter that scores differently from the server is worse than no
// meter at all — it either promises a password the server then rejects, or
// waves through one the server would have refused, teaching the visitor that
// the gauge is decoration. One function, one threshold, both sides.
//
// Deliberately dependency-free and side-effect-free: it runs inside the
// Convex runtime (no Node built-ins) and inside the browser bundle (no
// megabyte wordlist). The common-password list below is small on purpose —
// see `COMMON_PASSWORDS`.

/** Machine-readable reasons a score is what it is. */
export type PasswordIssue =
  | "TOO_SHORT"
  | "TOO_LONG"
  /** Equals a well-known password once leetspeak and trailing filler are undone. */
  | "COMMON"
  /** Built out of the address it protects. */
  | "DERIVED_FROM_EMAIL"
  /** One character, over and over. */
  | "REPEATED"
  /** A straight run through the alphabet, the digits, or a keyboard row. */
  | "SEQUENTIAL"
  /** Long enough, but not varied or long enough to clear the floor. */
  | "TOO_SIMPLE"

export interface PasswordStrength {
  /** 0 (rejected) to 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4
  issues: PasswordIssue[]
}

// Defined here rather than in `auth.ts` so there is one definition rather
// than two that can drift: `auth.ts` re-exports these for the Better Auth
// config, and this module can be imported from the browser without dragging
// Better Auth and the Convex component wiring into the bundle.
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

/**
 * The floor `invitations.accept` enforces and the form blocks below. A score
 * of 2 is reachable at the 8-character minimum with three character classes,
 * at 10 characters with two, or by any passphrase of 16+ — so this tightens
 * the *shape* of short passwords without moving `MIN_PASSWORD_LENGTH`.
 */
export const MIN_PASSWORD_SCORE = 2

// Not a dictionary — a shortlist of the passwords that actually top the
// breach corpora, in the two languages this template ships in. A real
// wordlist belongs server-side behind a lookup, and would still be defeated
// by the same person appending "!" — the leet-folding normalisation below is
// what does the useful work here, by collapsing "P@ssw0rd1" onto "password".
const COMMON_PASSWORDS = new Set([
  "password", "passwort", "passord", "motdepasse", "secret",
  "azerty", "qwerty", "qwertz", "azertyuiop", "qwertyuiop",
  "admin", "administrator", "administrateur", "root", "toor",
  "letmein", "welcome", "bienvenue", "iloveyou", "jetaime",
  "monkey", "dragon", "football", "baseball", "soleil",
  "abcdef", "abcdefg", "abcdefgh", "sunshine", "princess",
  "master", "shadow", "michael", "login", "connexion",
  "test", "changeme", "default", "bonjour", "coucou",
])

const KEYBOARD_ROWS = [
  "azertyuiop",
  "qwertyuiop",
  "qwertzuiop",
  "asdfghjkl",
  "qsdfghjklm",
  "zxcvbnm",
  "wxcvbn",
  "1234567890",
]

const LEET: Record<string, string> = {
  "4": "a", "@": "a", "8": "b", "3": "e", "1": "i", "!": "i",
  "|": "i", "0": "o", "5": "s", "$": "s", "7": "t", "+": "t",
}

/**
 * Fold a password onto the word a human was probably thinking of: lowercase,
 * undo leetspeak, then strip the filler people append to satisfy a rule
 * ("Password1!" and "p4ssw0rd" both land on "password").
 */
function normalize(password: string): string {
  // Order matters, and getting it wrong is silent: the leet table maps "1"
  // onto "i", so folding first turns "P@ssw0rd1" into "passwordi" — the
  // trailing digit has become a letter and the strip below no longer sees
  // it. Strip the edges off the raw string first, *then* fold what's left.
  // Edge-stripping is where the appended "1!" that satisfies a complexity
  // rule dies; folding is where the interior "@" and "0" die.
  const trimmed = password
    .replace(/[^a-zA-ZÀ-ÿ]+$/u, "")
    .replace(/^[^a-zA-ZÀ-ÿ]+/u, "")
  return trimmed
    .toLowerCase()
    .split("")
    .map((char) => LEET[char] ?? char)
    .join("")
}

function countClasses(password: string): number {
  let classes = 0
  if (/[a-z]/.test(password)) classes++
  if (/[A-Z]/.test(password)) classes++
  if (/[0-9]/.test(password)) classes++
  if (/[^a-zA-Z0-9]/.test(password)) classes++
  return classes
}

function isRepeated(password: string): boolean {
  const lower = password.toLowerCase()
  return lower.length > 0 && [...lower].every((char) => char === lower[0])
}

function isSequential(password: string): boolean {
  const lower = password.toLowerCase()
  if (lower.length < 4) return false

  // A straight run through the codepoints, forwards or backwards:
  // "12345678", "abcdefgh", "87654321".
  let ascending = true
  let descending = true
  for (let index = 1; index < lower.length; index++) {
    const delta = lower.charCodeAt(index) - lower.charCodeAt(index - 1)
    if (delta !== 1) ascending = false
    if (delta !== -1) descending = false
  }
  if (ascending || descending) return true

  // A slice of a keyboard row, either direction.
  const reversed = [...lower].reverse().join("")
  return KEYBOARD_ROWS.some(
    (row) => row.includes(lower) || row.includes(reversed)
  )
}

/**
 * `true` when the password is built out of the address it protects — the
 * local part inside the password, or the password inside the local part.
 * Below three characters the local part is too short for the containment
 * test to mean anything ("al" appears inside plenty of real words).
 */
function isDerivedFromEmail(password: string, email: string | undefined): boolean {
  if (!email) return false
  const local = email.split("@")[0]?.toLowerCase() ?? ""
  if (local.length < 3) return false
  const normalized = normalize(password)
  if (normalized.length === 0) return false
  return normalized.includes(local) || local.includes(normalized)
}

/**
 * Score a password from 0 (rejected) to 4 (strong).
 *
 * The scale is deliberately not "one point per character class": that is the
 * rule that scores "P@ssw0rd1" full marks while it sits near the top of every
 * breach corpus. Character classes raise the ceiling here, but a password
 * that folds onto a common word, onto its own email address, onto one
 * repeated character, or onto a keyboard run is capped at 1 no matter how
 * ornamented it is.
 */
export function scorePassword(
  password: string,
  options: { email?: string } = {}
): PasswordStrength {
  const issues: PasswordIssue[] = []

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { score: 0, issues: ["TOO_SHORT"] }
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { score: 0, issues: ["TOO_LONG"] }
  }

  // The caps. Each is a way for a password to look complex and still fall to
  // the first thing an attacker tries.
  if (COMMON_PASSWORDS.has(normalize(password))) issues.push("COMMON")
  if (isDerivedFromEmail(password, options.email)) issues.push("DERIVED_FROM_EMAIL")
  if (isRepeated(password)) issues.push("REPEATED")
  if (isSequential(password)) issues.push("SEQUENTIAL")
  if (issues.length > 0) return { score: 1, issues }

  const length = password.length
  const classes = countClasses(password)

  let score: PasswordStrength["score"] = 1
  // Two routes to each rung: variety, or sheer length. A four-word
  // passphrase is all-lowercase and stronger than anything typeable in
  // eight characters, so length alone has to be able to carry the score.
  if ((classes >= 3 && length >= 8) || (classes >= 2 && length >= 10) || length >= 16) {
    score = 2
  }
  if ((classes >= 3 && length >= 12) || (classes >= 2 && length >= 14) || length >= 20) {
    score = 3
  }
  if ((classes >= 3 && length >= 16) || (classes >= 4 && length >= 14) || length >= 25) {
    score = 4
  }

  if (score < MIN_PASSWORD_SCORE) issues.push("TOO_SIMPLE")
  return { score, issues }
}

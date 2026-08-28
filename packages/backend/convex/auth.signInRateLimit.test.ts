import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { ORIGIN, makeTestConvex, seedUser } from "../testing/betterAuthFixture"
import { SIGN_IN_RATE_LIMIT_CONFIG } from "./lib/signInRateLimit"

// Drives the *real* HTTP surface (`http.ts` -> `authComponent.registerRoutes`
// -> better-auth's own router -> `/sign-in/email`), same discipline as
// `auth.ownerInvariant.test.ts` for the same reason: the thing actually
// being guarded is an HTTP endpoint no application mutation wraps, so
// testing anything less than the real path would prove nothing about what
// an attacker (or a legitimate owner) actually experiences.
//
// "Origin" in these tests is simulated via `x-forwarded-for`, exactly the
// header `getIp` (better-auth's own, reused rather than reimplemented —
// see `auth.ts`) reads by default.

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
})

afterEach(() => {
  process.env = originalEnv
  vi.useRealTimers()
})

async function attemptSignIn(
  t: ReturnType<typeof makeTestConvex>,
  email: string,
  password: string,
  originIp: string,
) {
  return t.fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "x-forwarded-for": originIp,
    },
    body: JSON.stringify({ email, password }),
  })
}

async function expectRateLimited(res: Response) {
  expect(res.status).toBe(429)
  const body = (await res.clone().json()) as { code?: string; message?: string }
  expect(body.code).toBe("SIGN_IN_RATE_LIMITED")
  return body
}

const OWNER_EMAIL = "owner@example.com"
const OWNER_PASSWORD = "correct horse battery staple 1"
const ATTACKER_IP = "203.0.113.10"
const OWNER_IP = "198.51.100.20"

test("sous le seuil : les tentatives échouent normalement (401), pas de blocage prématuré", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    name: "Owner",
    role: "owner",
  })

  for (let i = 0; i < SIGN_IN_RATE_LIMIT_CONFIG.rate; i++) {
    const res = await attemptSignIn(t, OWNER_EMAIL, "wrong password", ATTACKER_IP)
    expect(res.status).toBe(401)
  }
})

test("dépassement du seuil : refusé avec un code distinct (429 SIGN_IN_RATE_LIMITED), pas un simple 401", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    name: "Owner",
    role: "owner",
  })

  for (let i = 0; i < SIGN_IN_RATE_LIMIT_CONFIG.rate; i++) {
    const res = await attemptSignIn(t, OWNER_EMAIL, "wrong password", ATTACKER_IP)
    expect(res.status).toBe(401)
  }

  // One more, past the threshold: refused, and refused *differently* from
  // a wrong password — an honest signal, not the same generic 401.
  const blocked = await attemptSignIn(t, OWNER_EMAIL, "wrong password", ATTACKER_IP)
  await expectRateLimited(blocked)

  // The *correct* password, from the same exhausted (origin, email) pair,
  // is refused identically — the gate fires before the credential check
  // ever runs, so it can't be bypassed just by finally getting the
  // password right while the window is still open.
  const blockedEvenCorrect = await attemptSignIn(t, OWNER_EMAIL, OWNER_PASSWORD, ATTACKER_IP)
  await expectRateLimited(blockedEvenCorrect)
})

test("l'owner n'est PAS verrouillé par un attaquant qui épuise le compteur depuis une autre origine", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    name: "Owner",
    role: "owner",
  })

  // Attacker, from their own origin, knows the owner's address (this app
  // is invitation-only — every address in use was chosen by an admin) and
  // exhausts the (attackerIp, ownerEmail) bucket.
  for (let i = 0; i <= SIGN_IN_RATE_LIMIT_CONFIG.rate; i++) {
    await attemptSignIn(t, OWNER_EMAIL, "wrong password", ATTACKER_IP)
  }
  const confirmBlocked = await attemptSignIn(t, OWNER_EMAIL, "wrong password", ATTACKER_IP)
  await expectRateLimited(confirmBlocked)

  // The real owner, moments later, from their *own* origin, with the
  // *correct* password: succeeds. This is the property this whole design
  // exists to prove — per-email-only rate limiting would have locked this
  // out too, since the attacker above never left the owner's origin alone.
  const ownerSignIn = await attemptSignIn(t, OWNER_EMAIL, OWNER_PASSWORD, OWNER_IP)
  expect(ownerSignIn.status).toBe(200)
})

test("pas d'oracle d'existence de compte : un email inconnu est limité au même seuil, avec le même code", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    name: "Owner",
    role: "owner",
  })
  const UNKNOWN_EMAIL = "nobody-with-this-address-exists@example.com"

  for (let i = 0; i < SIGN_IN_RATE_LIMIT_CONFIG.rate; i++) {
    const res = await attemptSignIn(t, UNKNOWN_EMAIL, "whatever", ATTACKER_IP)
    // Same 401 a wrong password against a *real* account gets — better-auth
    // itself already collapses "no such user" and "wrong password" onto
    // the identical INVALID_EMAIL_OR_PASSWORD response; this gate must not
    // reopen that by behaving differently underneath it.
    expect(res.status).toBe(401)
  }

  const blocked = await attemptSignIn(t, UNKNOWN_EMAIL, "whatever", ATTACKER_IP)
  const body = await expectRateLimited(blocked)
  // Identical shape to the known-account case above — an attacker probing
  // an address cannot tell, from this response, whether it belongs to a
  // real account: both get blocked after the same number of tries with
  // the same code.
  expect(body.code).toBe("SIGN_IN_RATE_LIMITED")
})

test("un email et un IP différents ne partagent pas le compteur d'un autre couple", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    name: "Owner",
    role: "owner",
  })
  const otherEmail = "second-account@example.com"
  await seedUser(t, {
    email: otherEmail,
    password: "correct horse battery staple 2",
    name: "Second",
    role: "editor",
  })

  // Exhaust (ATTACKER_IP, OWNER_EMAIL).
  for (let i = 0; i <= SIGN_IN_RATE_LIMIT_CONFIG.rate; i++) {
    await attemptSignIn(t, OWNER_EMAIL, "wrong password", ATTACKER_IP)
  }
  await expectRateLimited(await attemptSignIn(t, OWNER_EMAIL, "wrong password", ATTACKER_IP))

  // Same origin, *different* account: not affected — a shared address
  // (an office NAT, in production) trying one account's credentials
  // doesn't spend a different account's budget.
  const otherAccountFromSameIp = await attemptSignIn(
    t,
    otherEmail,
    "correct horse battery staple 2",
    ATTACKER_IP,
  )
  expect(otherAccountFromSameIp.status).toBe(200)
})

test("le blocage s'auto-expire : le bon mot de passe refonctionne une fois la fenêtre écoulée (pas un verrouillage permanent)", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    name: "Owner",
    role: "owner",
  })

  vi.useFakeTimers()
  try {
    for (let i = 0; i <= SIGN_IN_RATE_LIMIT_CONFIG.rate; i++) {
      await attemptSignIn(t, OWNER_EMAIL, "wrong password", ATTACKER_IP)
    }
    await expectRateLimited(await attemptSignIn(t, OWNER_EMAIL, "wrong password", ATTACKER_IP))

    // Advance past the fixed window.
    vi.setSystemTime(Date.now() + SIGN_IN_RATE_LIMIT_CONFIG.period + 1)

    const afterWindow = await attemptSignIn(t, OWNER_EMAIL, OWNER_PASSWORD, ATTACKER_IP)
    expect(afterWindow.status).toBe(200)
  } finally {
    vi.useRealTimers()
  }
})

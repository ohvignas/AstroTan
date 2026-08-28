import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { ORIGIN, makeTestConvex, seedUser } from "../testing/betterAuthFixture"
import { SIGN_IN_EMAIL_RATE_LIMIT_CONFIG, SIGN_IN_RATE_LIMIT_CONFIG } from "./lib/signInRateLimit"

// better-auth's own `getIp` (`better-auth/dist/utils/get-request-ip.mjs`)
// falls back to the literal string `"127.0.0.1"` — never `null` — whenever
// `NODE_ENV` is `test` or `development` (or unset, whose own fallback is
// `"development"`; see `@better-auth/core/env`'s `getEnvVar`). That's a
// dev-convenience shim with nothing to do with rate limiting, but it means
// "no `x-forwarded-for` header" can never be observed, under `vitest`
// (`NODE_ENV=test`), as `getIp(...) === null` the way it genuinely is in a
// real `NODE_ENV=production` deployment — the exact fact C1 relies on.
// `nodeENV` is also captured as a module-scope `const` at first import, so
// no amount of `process.env.NODE_ENV` juggling inside a test can undo it
// once better-auth's env module has already loaded.
//
// Mocked here to remove exactly that shim, nothing else: every other
// export of `better-auth/api` passes through unmodified via
// `importOriginal`, and the replacement `getIp` reimplements the *real*
// logic faithfully (read `x-forwarded-for`, split on the first comma, trim)
// minus only the `isTest()/isDevelopment()` fallback — so this file still
// drives the real HTTP surface, real router, real rate-limiter component,
// and real header-reading behavior for every test below; only the
// environment-detection quirk that would otherwise make "absent header"
// unobservable in this test runner is removed.
vi.mock("better-auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth/api")>()
  return {
    ...actual,
    getIp: (req: Request | Headers) => {
      const headers = "headers" in req ? req.headers : req
      const value = headers.get("x-forwarded-for")
      if (typeof value !== "string") return null
      const ip = value.split(",")[0]?.trim()
      return ip && ip.length > 0 ? ip : null
    },
  }
})

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

  // Le temps est figé pour toute cette suite. Ce n'était PAS la cause des
  // échecs observés — c'était une expiration de test, corrigée par
  // `testTimeout` dans `vitest.config.ts` — mais le risque que ce gel
  // écarte est réel et vaut d'être gardé : chaque tentative fait un vrai
  // hachage de mot de passe, les deux limiteurs sont à fenêtre fixe, et une
  // boucle assez lente verrait la fenêtre basculer en plein test, rendant
  // un quota neuf à la tentative censée être refusée.
  //
  // Seul `Date` est simulé, jamais les minuteries : les promesses doivent
  // continuer de se résoudre normalement, sinon `t.fetch` ne rend jamais la
  // main. Le test d'auto-expiration plus bas avance délibérément l'horloge
  // avec `vi.setSystemTime` — il continue de fonctionner, c'est exactement
  // à ça que sert une horloge simulée.
  vi.useFakeTimers({ toFake: ["Date"] })
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

// No `x-forwarded-for` at all — the direct-to-`*.convex.site` curl path C1
// describes, which bypasses the admin's same-origin proxy (and its
// `x-forwarded-for` forwarding) entirely. `origin` is still sent (better
// -auth's own CSRF-style origin check, unrelated to rate limiting) — the
// point of this request is the *absent* forwarded-for header, not an
// unauthenticated origin.
async function attemptSignInNoForwardedFor(
  t: ReturnType<typeof makeTestConvex>,
  email: string,
  password: string,
) {
  return t.fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  })
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

// C1 (Lot 1 final review) — the two gaps in the design above, both
// unexercised by every test that precedes this one: every one of them
// supplies an explicit `x-forwarded-for`, so neither "an attacker rotates
// it" nor "an attacker omits it" was ever driven through the real HTTP
// surface. Both are, per the review, why the (origin, email) bucket alone
// is a no-op against the attacker it names — see `lib/signInRateLimit.ts`'s
// header comment on `SIGN_IN_EMAIL_RATE_LIMIT_CONFIG` for the fix (a
// second, origin-independent bucket keyed on the email alone) and why the
// tight bucket is skipped rather than kept, specifically when the origin
// can't be resolved at all.

test("C1 : la rotation de x-forwarded-for ne contourne pas la limite — le compteur par email seul finit par refuser", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    name: "Owner",
    role: "owner",
  })

  // A fresh, never-before-seen origin on every single attempt: the tight
  // (origin, email) bucket never sees the same key twice, so it never
  // fires — this is exactly the "unbounded" failure mode C1 names. Only
  // the wide, origin-independent backstop can still catch this.
  for (let i = 0; i < SIGN_IN_EMAIL_RATE_LIMIT_CONFIG.rate; i++) {
    const res = await attemptSignIn(t, OWNER_EMAIL, "wrong password", `203.0.113.${i}`)
    expect(res.status).toBe(401)
  }

  const blocked = await attemptSignIn(t, OWNER_EMAIL, "wrong password", "203.0.113.250")
  await expectRateLimited(blocked)
})

test("C1 : sans x-forwarded-for du tout, le compteur par email seul s'applique (pas le petit compteur par origine)", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    name: "Owner",
    role: "owner",
  })

  // No forwarded-for header at all on any attempt: every one of them
  // resolves to the same `UNRESOLVED_SIGN_IN_ORIGIN` sentinel. Keying the
  // tight bucket on that sentinel (as if it were a real, stable origin)
  // would collapse every headerless request for this email onto one
  // shared 5-per-2-minute budget — indistinguishable from a plain
  // per-email limiter, and exactly what let an attacker with no proxy in
  // front of them lock the real owner out. The fix skips the tight bucket
  // when the origin can't be resolved, so only the wide (50/hour) backstop
  // applies here — proven by getting all the way to that bound, not just
  // "eventually blocked".
  for (let i = 0; i < SIGN_IN_EMAIL_RATE_LIMIT_CONFIG.rate; i++) {
    const res = await attemptSignInNoForwardedFor(t, OWNER_EMAIL, "wrong password")
    expect(res.status).toBe(401)
  }

  const blocked = await attemptSignInNoForwardedFor(t, OWNER_EMAIL, "wrong password")
  await expectRateLimited(blocked)
})

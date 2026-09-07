import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { Resend } from "@convex-dev/resend"
import { api } from "./_generated/api"
import { ORIGIN, identityFor, makeTestConvex, seedUser, signIn } from "../testing/betterAuthFixture"
import { EMAIL_TEST_DEMO_LIMIT } from "./lib/emailTestQuota"

const DEMO_EMAIL = "demo@astrotan.invalid"
const DEMO_PASSWORD = "correct horse battery staple demo"
const DEST = "boite-de-test@exemple.fr"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env.RESEND_API_KEY = "re_test_key"
  process.env.RESEND_TEST_MODE = "false"
  delete process.env.DEMO_SANDBOX
  delete process.env.DEMO_ACCOUNT_EMAIL
})

afterEach(() => {
  process.env = originalEnv
  vi.restoreAllMocks()
})

async function seedActor(
  t: ReturnType<typeof makeTestConvex>,
  role: "owner" | "admin" | "editor",
  email?: string,
) {
  const resolved = email ?? `test-mail-${role}-${Date.now()}-${Math.random()}@exemple.fr`
  const password = "correct horse battery staple emails"
  const user = await seedUser(t, { email: resolved, password, name: `Actor ${role}`, role })
  await signIn(t, resolved, password)
  return { user, email: resolved, identity: await identityFor(t, user.id) }
}

function capturerLesEnvois(): { to: string | string[]; subject: string }[] {
  const envoyes: { to: string | string[]; subject: string }[] = []
  vi.spyOn(Resend.prototype, "sendEmail").mockImplementation((async (
    _ctx: unknown,
    options: { to: string | string[]; subject: string },
  ) => {
    envoyes.push(options)
    return "email-de-test"
  }) as unknown as Resend["sendEmail"])
  return envoyes
}

function activerSandbox(email = DEMO_EMAIL) {
  process.env.DEMO_SANDBOX = "true"
  process.env.DEMO_ACCOUNT_EMAIL = email
}

test("un editor envoie un test vers l'adresse saisie, sans renvoyer la clé", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "editor")
  const envois = capturerLesEnvois()

  const resultat = await identity.action(api.emails.envoyerTest, { to: DEST })

  expect(resultat).toEqual({ ok: true, to: DEST, testMode: false })
  expect(envois).toHaveLength(1)
  expect(envois[0]!.to).toBe(DEST)
  expect(JSON.stringify(resultat)).not.toContain("re_test_key")
})

test("le compte démo peut envoyer un test : pas DEMO_FORBIDDEN", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "editor", DEMO_EMAIL)
  activerSandbox()
  const envois = capturerLesEnvois()

  await expect(identity.action(api.emails.envoyerTest, { to: DEST })).resolves.toEqual({
    ok: true,
    to: DEST,
    testMode: false,
  })
  expect(envois).toHaveLength(1)
})

test("un owner envoie aussi via le même bouton", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "owner")
  capturerLesEnvois()
  await expect(identity.action(api.emails.envoyerTest, { to: DEST })).resolves.toMatchObject({
    ok: true,
    to: DEST,
  })
})

test("sans session, l'envoi de test est refusé", async () => {
  const t = makeTestConvex()
  await expect(t.action(api.emails.envoyerTest, { to: DEST })).rejects.toThrow()
})

test("une adresse invalide lève INVALID_EMAIL", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "editor")
  await expect(identity.action(api.emails.envoyerTest, { to: "pas-une-adresse" })).rejects.toMatchObject(
    { data: { code: "INVALID_EMAIL" } },
  )
})

test("une adresse trop longue lève FIELD_TOO_LONG aux deux bornes", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "editor")
  const max = 254
  const local = "a".repeat(max - "@x.fr".length)
  capturerLesEnvois()
  await expect(
    identity.action(api.emails.envoyerTest, { to: `${local}@x.fr` }),
  ).resolves.toMatchObject({ ok: true })
  await expect(
    identity.action(api.emails.envoyerTest, { to: `${local}x@x.fr` }),
  ).rejects.toMatchObject({ data: { code: "FIELD_TOO_LONG", field: "to", max } })
})

test("sans clé Resend, l'envoi ne part pas et le dit", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "editor")
  delete process.env.RESEND_API_KEY
  const envois = capturerLesEnvois()
  await expect(identity.action(api.emails.envoyerTest, { to: DEST })).resolves.toEqual({
    ok: false,
    raison: "sans_cle",
  })
  expect(envois).toHaveLength(0)
})

test("en mode d'essai, le test part vers l'adresse Resend", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "editor")
  delete process.env.RESEND_TEST_MODE
  const envois = capturerLesEnvois()
  const resultat = await identity.action(api.emails.envoyerTest, { to: DEST })
  expect(resultat).toEqual({ ok: true, to: "delivered@resend.dev", testMode: true })
  expect(envois[0]!.to).toBe("delivered@resend.dev")
})

test("le compte démo est refusé au-delà du quota horaire", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "editor", DEMO_EMAIL)
  activerSandbox()
  capturerLesEnvois()
  expect(EMAIL_TEST_DEMO_LIMIT.rate).toBe(3)

  for (let n = 0; n < EMAIL_TEST_DEMO_LIMIT.rate; n++) {
    await expect(identity.action(api.emails.envoyerTest, { to: DEST })).resolves.toMatchObject({
      ok: true,
    })
  }
  await expect(identity.action(api.emails.envoyerTest, { to: DEST })).rejects.toMatchObject({
    data: { code: "RATE_LIMITED" },
  })
})

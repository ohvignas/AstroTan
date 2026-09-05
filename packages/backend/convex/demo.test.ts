import { afterEach, beforeEach, expect, test } from "vitest"
import { api, components, internal } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

const ENTER_SECRET = "demo-enter-secret-test-please-do-not-use"
const DEMO_EMAIL = "demo@astrotan.invalid"
const DEMO_PASSWORD = "correct horse battery staple demo"
const DEMO_MODEL = "google/gemini-3.7-flash"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  delete process.env.DEMO_SANDBOX
  delete process.env.DEMO_ENTER_SECRET
  delete process.env.DEMO_ACCOUNT_EMAIL
  delete process.env.DEMO_ACCOUNT_PASSWORD
  delete process.env.DEMO_OPENROUTER_MODEL
})

afterEach(() => {
  process.env = originalEnv
})

function activerSandbox() {
  process.env.DEMO_SANDBOX = "true"
  process.env.DEMO_ENTER_SECRET = ENTER_SECRET
  process.env.DEMO_ACCOUNT_EMAIL = DEMO_EMAIL
  process.env.DEMO_ACCOUNT_PASSWORD = DEMO_PASSWORD
  process.env.DEMO_OPENROUTER_MODEL = DEMO_MODEL
}

test("ouvert rend un objet inactif quand le flag est éteint", async () => {
  const t = makeTestConvex()
  expect(await t.query(api.demo.ouvert, {})).toEqual({
    actif: false,
    adminUrl: null,
  })
})

test("ouvert rend actif et une URL admin quand le flag est allumé", async () => {
  const t = makeTestConvex()
  process.env.DEMO_SANDBOX = "true"
  process.env.SITE_URL = "https://admin.exemple.fr"
  const ouvert = await t.query(api.demo.ouvert, {})
  expect(ouvert.actif).toBe(true)
  expect(ouvert.adminUrl).toMatch(/^https:\/\//)
  expect(typeof ouvert).toBe("object")
})

test("credentials refuse sans flag", async () => {
  const t = makeTestConvex()
  await expect(
    t.action(api.demo.credentials, { secret: ENTER_SECRET }),
  ).rejects.toMatchObject({ data: { code: "DEMO_OFF" } })
})

test("credentials refuse si le secret, l'e-mail, le mot de passe ou le modèle manque", async () => {
  const t = makeTestConvex()
  activerSandbox()

  delete process.env.DEMO_ENTER_SECRET
  await expect(
    t.action(api.demo.credentials, { secret: ENTER_SECRET }),
  ).rejects.toMatchObject({ data: { code: "DEMO_NOT_CONFIGURED" } })

  activerSandbox()
  delete process.env.DEMO_ACCOUNT_EMAIL
  await expect(
    t.action(api.demo.credentials, { secret: ENTER_SECRET }),
  ).rejects.toMatchObject({ data: { code: "DEMO_NOT_CONFIGURED" } })

  activerSandbox()
  delete process.env.DEMO_ACCOUNT_PASSWORD
  await expect(
    t.action(api.demo.credentials, { secret: ENTER_SECRET }),
  ).rejects.toMatchObject({ data: { code: "DEMO_NOT_CONFIGURED" } })

  activerSandbox()
  delete process.env.DEMO_OPENROUTER_MODEL
  await expect(
    t.action(api.demo.credentials, { secret: ENTER_SECRET }),
  ).rejects.toMatchObject({ data: { code: "DEMO_NOT_CONFIGURED" } })
})

test("credentials refuse un secret faux sans y coller le mot de passe", async () => {
  const t = makeTestConvex()
  activerSandbox()
  await expect(
    t.action(api.demo.credentials, { secret: "ce-secret-est-faux" }),
  ).rejects.toMatchObject({ data: { code: "DEMO_FORBIDDEN" } })
  try {
    await t.action(api.demo.credentials, { secret: "ce-secret-est-faux" })
    throw new Error("aurait dû lever")
  } catch (error) {
    expect(JSON.stringify(error)).not.toContain(DEMO_PASSWORD)
  }
})

test("credentials rend e-mail et mot de passe quand tout est en place", async () => {
  const t = makeTestConvex()
  activerSandbox()
  await expect(
    t.action(api.demo.credentials, { secret: ENTER_SECRET, ip: "203.0.113.10" }),
  ).resolves.toEqual({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
})

test("credentials refuse le 11ᵉ appel de la même IP", async () => {
  const t = makeTestConvex()
  activerSandbox()
  const args = { secret: ENTER_SECRET, ip: "203.0.113.11" }
  for (let n = 0; n < 10; n++) {
    await t.action(api.demo.credentials, args)
  }
  await expect(t.action(api.demo.credentials, args)).rejects.toMatchObject({
    data: { code: "DEMO_RATE_LIMITED" },
  })
})

test("credentials plafonne aussi un secret faux : le 11ᵉ appel est RATE_LIMITED", async () => {
  const t = makeTestConvex()
  activerSandbox()
  const args = { secret: "ce-secret-est-faux", ip: "203.0.113.12" }
  for (let n = 0; n < 10; n++) {
    await expect(t.action(api.demo.credentials, args)).rejects.toMatchObject({
      data: { code: "DEMO_FORBIDDEN" },
    })
  }
  await expect(t.action(api.demo.credentials, args)).rejects.toMatchObject({
    data: { code: "DEMO_RATE_LIMITED" },
  })
})

test("jeSuisDemo rend false sans session", async () => {
  const t = makeTestConvex()
  activerSandbox()
  expect(await t.query(api.demo.jeSuisDemo, {})).toBe(false)
})

test("jeSuisDemo rend true pour l'editor démo", async () => {
  const t = makeTestConvex()
  activerSandbox()
  const user = await seedUser(t, {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    name: "Démo",
    role: "editor",
  })
  await signIn(t, DEMO_EMAIL, DEMO_PASSWORD)
  const identity = await identityFor(t, user.id)
  expect(await identity.query(api.demo.jeSuisDemo, {})).toBe(true)
})

test("seedSandbox saute quand le flag est éteint", async () => {
  const t = makeTestConvex()
  expect(await t.mutation(internal.demo.seedSandbox, {})).toEqual({ skipped: true })
})

test("seedSandbox refuse une config incomplète", async () => {
  const t = makeTestConvex()
  process.env.DEMO_SANDBOX = "true"
  await expect(t.mutation(internal.demo.seedSandbox, {})).rejects.toMatchObject({
    data: { code: "DEMO_NOT_CONFIGURED" },
  })
})

test("seedSandbox crée un editor une seule fois", async () => {
  const t = makeTestConvex()
  activerSandbox()
  await t.mutation(internal.demo.seedSandbox, {})
  await t.mutation(internal.demo.seedSandbox, {})

  const page = await t.run(async (ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      paginationOpts: { numItems: 50, cursor: null },
    }),
  )
  expect(page.page).toHaveLength(1)
  const user = page.page[0] as { email?: string; role?: string }
  expect(user.email).toBe(DEMO_EMAIL)
  expect(user.role).toBe("editor")
})

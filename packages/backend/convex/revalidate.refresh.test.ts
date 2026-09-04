import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

const WEB_SITE_URL = "http://localhost:4321"
const REVALIDATE_SECRET = "test-revalidate-secret-please-do-not-use-in-prod-x"

let originalEnv: NodeJS.ProcessEnv
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env.WEB_SITE_URL = WEB_SITE_URL
  process.env.REVALIDATE_SECRET = REVALIDATE_SECRET
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  process.env = originalEnv
  vi.unstubAllGlobals()
})

async function seedEditor() {
  const t = makeTestConvex()
  const email = `refresh-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple refresh"
  const user = await seedUser(t, {
    email,
    password,
    name: "Editor",
    role: "editor",
  })
  await signIn(t, email, password)
  return { t, identity: await identityFor(t, user.id) }
}

test("refresh refuse un appelant sans session", async () => {
  const t = makeTestConvex()
  await expect(t.action(api.revalidate.refresh, {})).rejects.toThrow()
})

test("en local, Recharger vise WEB_SITE_URL, pas le domaine déclaré", async () => {
  const { t, identity } = await seedEditor()
  await t.run((ctx) =>
    ctx.db.insert("settings", { siteName: "Test", declaredDomain: "illith.com" }),
  )
  fetchMock.mockResolvedValue({ ok: true, status: 200 })

  const out = await identity.action(api.revalidate.refresh, {})
  expect(out).toEqual({ ok: true, origin: WEB_SITE_URL })
  expect(fetchMock.mock.calls[0]?.[0]).toBe(`${WEB_SITE_URL}/api/revalidate`)
  expect(fetchMock.mock.calls[0]?.[0]).not.toContain("illith.com")
  expect(fetchMock.mock.calls[0]?.[0]).not.toContain("3001")
})

test("hors local, Recharger vise le domaine déclaré", async () => {
  const { t, identity } = await seedEditor()
  process.env.WEB_SITE_URL = "https://ancien.fr"
  await t.run((ctx) =>
    ctx.db.insert("settings", { siteName: "Test", declaredDomain: "exemple.fr" }),
  )
  fetchMock.mockResolvedValue({ ok: true, status: 200 })

  const out = await identity.action(api.revalidate.refresh, {})
  expect(out.ok).toBe(true)
  expect(out.origin).toBe("https://exemple.fr")
  expect(fetchMock.mock.calls[0]?.[0]).toBe("https://exemple.fr/api/revalidate")
})

test("un site injoignable rend ok: false, sans lever", async () => {
  const { identity } = await seedEditor()
  fetchMock.mockRejectedValue(new Error("ECONNREFUSED"))

  const out = await identity.action(api.revalidate.refresh, {})
  expect(out.ok).toBe(false)
  expect(out.origin).toBe(WEB_SITE_URL)
})

import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import schema from "./schema"
import { clearUmamiToken } from "./lib/umamiToken"
import { api } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  // Le cache de jeton est en portée module : sans cela, un test hérite du
  // jeton du précédent et « le jeton est réutilisé » ne prouve plus rien.
  clearUmamiToken()
})

afterEach(() => {
  process.env = originalEnv
  vi.restoreAllMocks()
})

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor"
) {
  const email = `analytics-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple analytics"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

function configure() {
  process.env.UMAMI_API_URL = "https://umami.illith.test"
  process.env.UMAMI_API_WEBSITE_ID = "site-1"
  process.env.UMAMI_API_USERNAME = "lecture"
  process.env.UMAMI_API_PASSWORD = "secret"
}

test("refuse un appelant sans session", async () => {
  const t = makeTestConvex()
  configure()
  await expect(
    t.action(api.analytics.forPath, { path: "/contact" }),
  ).rejects.toThrow()
})

test("sans configuration, rend un état lisible plutôt qu'une erreur", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  delete process.env.UMAMI_API_URL

  // Un template livré sans statistiques ne doit pas avoir l'air cassé.
  const result = await editor.identity.action(api.analytics.forPath, { path: "/" })
  expect(result).toEqual({ last7: null, last30: null, status: "not-configured" })
})

test("un service injoignable ne casse pas le tableau de bord", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))

  // Des statistiques sont une information, jamais une dépendance de
  // l'édition d'une page.
  const result = await editor.identity.action(api.analytics.forPath, { path: "/" })
  expect(result.status).toBe("unreachable")
  expect(result.last7).toBeNull()
})

test("des identifiants refusés sont rapportés comme tels", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
  )

  const result = await editor.identity.action(api.analytics.forPath, { path: "/" })
  expect(result.status).toBe("unauthorized")
})

test("rend les vues et visiteurs sur 7 et 30 jours, filtrés par chemin", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()

  const urls: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(String(url))
      if (String(url).includes("/api/auth/login")) {
        return { ok: true, status: 200, json: async () => ({ token: "jeton" }) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ pageviews: { value: 42 }, visitors: { value: 7 } }),
      }
    }),
  )

  const result = await editor.identity.action(api.analytics.forPath, {
    path: "/blog/bienvenue",
  })
  expect(result.status).toBe("ok")
  expect(result.last7).toEqual({ pageviews: 42, visitors: 7 })
  expect(result.last30).toEqual({ pageviews: 42, visitors: 7 })

  // C'est le filtre par chemin qui rend la mesure utile à côté de
  // l'éditeur d'une page précise, plutôt qu'un total du site.
  const statsCalls = urls.filter((u) => u.includes("/stats"))
  expect(statsCalls).toHaveLength(2)
  expect(statsCalls[0]).toContain(encodeURIComponent("/blog/bienvenue"))
})

test("le jeton est réutilisé plutôt que redemandé à chaque appel", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()

  let logins = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/api/auth/login")) {
        logins++
        return { ok: true, status: 200, json: async () => ({ token: "jeton" }) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ pageviews: { value: 1 }, visitors: { value: 1 } }),
      }
    }),
  )

  await editor.identity.action(api.analytics.forPath, { path: "/a" })
  await editor.identity.action(api.analytics.forPath, { path: "/b" })

  // Rappeler l'endpoint de connexion à chaque rendu mettrait les
  // identifiants sur le réseau bien plus souvent que nécessaire.
  expect(logins).toBe(1)
})

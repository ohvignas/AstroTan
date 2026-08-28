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
  delete process.env.UMAMI_API_SHARE_ID
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
        // Charge utile RÉELLE d'Umami 3.3.1 : des nombres plats. La v2
        // rendait `{value, prev}` ; lue comme telle, chaque mesure sortait
        // à zéro.
        json: async () => ({ pageviews: 42, visitors: 7, visits: 7 }),
      }
    }),
  )

  const result = await editor.identity.action(api.analytics.forPath, {
    path: "/blog/bienvenue",
  })
  expect(result.status).toBe("ok")
  expect(result.last7).toEqual({ pageviews: 42, visitors: 7 })
  expect(result.last30).toEqual({ pageviews: 42, visitors: 7 })

  // Le filtre s'appelle `path`. Umami 3 accepte `url` et l'IGNORE : la
  // réponse est alors celle du site entier, présentée comme celle de la
  // page. Vérifié contre 3.3.1.
  const statsCalls = urls.filter((u) => u.includes("/stats"))
  expect(statsCalls).toHaveLength(2)
  expect(statsCalls[0]).toContain(`path=${encodeURIComponent("/blog/bienvenue")}`)
  expect(statsCalls[0]).not.toContain("url=")
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
        json: async () => ({ pageviews: 1, visitors: 1 }),
      }
    }),
  )

  await editor.identity.action(api.analytics.forPath, { path: "/a" })
  await editor.identity.action(api.analytics.forPath, { path: "/b" })

  // Rappeler l'endpoint de connexion à chaque rendu mettrait les
  // identifiants sur le réseau bien plus souvent que nécessaire.
  expect(logins).toBe(1)
})

test("umamiLinks refuse un appelant sans session", async () => {
  const t = makeTestConvex()
  configure()
  await expect(t.query(api.analytics.umamiLinks, {})).rejects.toThrow()
})

test("umamiLinks rend null quand rien n'est configuré — le menu cache alors le bouton", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  delete process.env.UMAMI_API_URL

  // Un bouton mort est pire que pas de bouton.
  expect(await editor.identity.query(api.analytics.umamiLinks, {})).toBeNull()
})

test("umamiLinks rend les adresses, sans jamais les identifiants", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()

  const links = await editor.identity.query(api.analytics.umamiLinks, {})
  expect(links).toEqual({
    dashboard: "https://umami.illith.test",
    admin: "https://umami.illith.test",
    shared: false,
  })
  // Ce que le navigateur reçoit, ce sont des adresses publiques, rien d'autre.
  expect(JSON.stringify(links)).not.toContain("secret")
  expect(JSON.stringify(links)).not.toContain("lecture")
})

function stubSite() {
  return vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes("/api/auth/login")) {
      return { ok: true, status: 200, json: async () => ({ token: "jeton" }) }
    }
    if (u.includes("/pageviews")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sessions: [
            { x: "2026-08-01T00:00:00Z", y: 5 },
            { x: "2026-08-02T00:00:00Z", y: 9 },
          ],
          pageviews: [
            { x: "2026-08-01T00:00:00Z", y: 12 },
            { x: "2026-08-02T00:00:00Z", y: 20 },
          ],
        }),
      }
    }
    if (u.includes("type=path")) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ x: "/blog/bienvenue", y: 312 }, { x: "/", y: 189 }],
      }
    }
    if (u.includes("type=referrer")) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ x: "google.com", y: 128 }, { x: "", y: 94 }],
      }
    }
    return {
      ok: true,
      status: 200,
      // Forme réelle d'Umami 3 : nombres plats, et `comparison` porte les
      // valeurs ABSOLUES de la période précédente — seulement quand la
      // requête demande `compare=prev`.
      json: async () => ({
        pageviews: 128,
        visitors: 44,
        comparison: { pageviews: 118, visitors: 39 },
      }),
    }
  })
}

test("siteSummary rend totaux, période précédente, série et palmarès", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  vi.stubGlobal("fetch", stubSite())

  const result = await editor.identity.action(api.analytics.siteSummary, {})
  expect(result.status).toBe("ok")
  expect(result.totals).toEqual({
    pageviews: { value: 128, prev: 118 },
    visitors: { value: 44, prev: 39 },
  })
  expect(result.series).toEqual([
    { date: "2026-08-01T00:00:00Z", visitors: 5, pageviews: 12 },
    { date: "2026-08-02T00:00:00Z", visitors: 9, pageviews: 20 },
  ])
  expect(result.topPages).toEqual([
    { label: "/blog/bienvenue", views: 312 },
    { label: "/", views: 189 },
  ])
  // Umami rend le referrer vide pour un accès direct. Le laisser vide
  // afficherait une ligne sans étiquette, illisible.
  expect(result.topReferrers).toEqual([
    { label: "google.com", views: 128 },
    { label: "Accès direct", views: 94 },
  ])
})

test("siteSummary : un palmarès en échec ne coûte pas le tableau de bord", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  const base = stubSite()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("type=referrer")
        ? { ok: false, status: 500, json: async () => ({}) }
        : base(url),
    ),
  )

  // Les chiffres principaux valent mieux qu'un écran vide : la liste
  // manquante se signale, elle ne fait pas tomber le reste.
  const result = await editor.identity.action(api.analytics.siteSummary, {})
  expect(result.status).toBe("ok")
  expect(result.totals?.visitors.value).toBe(44)
  expect(result.topReferrers).toBeNull()
})

test("siteSummary sans configuration ne lève pas", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  delete process.env.UMAMI_API_URL

  const result = await editor.identity.action(api.analytics.siteSummary, {})
  expect(result.status).toBe("not-configured")
  expect(result.totals).toBeNull()
})

test("siteSummary demande explicitement la comparaison et le bon type de palmarès", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()

  const urls: string[] = []
  const base = stubSite()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(String(url))
      return base(url)
    }),
  )

  await editor.identity.action(api.analytics.siteSummary, {})

  // Sans `compare=prev`, Umami 3 rend `comparison` à zéro SANS erreur : les
  // tendances passeraient toutes pour des progressions depuis rien.
  expect(urls.find((u) => u.includes("/stats"))).toContain("compare=prev")
  // `type=url` répond 400 en Umami 3 ; le type s'appelle `path`.
  expect(urls.some((u) => u.includes("type=path"))).toBe(true)
  expect(urls.some((u) => u.includes("type=url"))).toBe(false)
})

test("le partage change où l'on consulte, jamais où l'on administre", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  process.env.UMAMI_API_SHARE_ID = "astrotan-demo"

  const links = await editor.identity.query(api.analytics.umamiLinks, {})
  // `/share/<id>` affiche le tableau de bord en lecture seule, sans
  // connexion. Régler Umami passe toujours par la racine et un mot de
  // passe : aucun lien ne donne l'administration sans se connecter.
  expect(links).toEqual({
    dashboard: "https://umami.illith.test/share/astrotan-demo",
    admin: "https://umami.illith.test",
    shared: true,
  })
})

test("sans partage activé, consulter passe aussi par la connexion", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  delete process.env.UMAMI_API_SHARE_ID

  // Le partage reste une décision d'opérateur : le lien est un secret
  // porteur, et l'activer par défaut exposerait des statistiques que
  // personne n'a choisi de publier.
  const links = await editor.identity.query(api.analytics.umamiLinks, {})
  expect(links?.dashboard).toBe("https://umami.illith.test")
  expect(links?.shared).toBe(false)
})

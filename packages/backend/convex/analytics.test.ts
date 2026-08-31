import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import schema from "./schema"
import { clearUmamiToken } from "./lib/umamiToken"
import { fenetreFor } from "./analytics"
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
  process.env.UMAMI_API_URL = "https://umami.exemple.test"
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
    dashboard: "https://umami.exemple.test",
    shared: false,
  })
  // Ce que le navigateur reçoit, ce sont des adresses publiques, rien d'autre.
  expect(JSON.stringify(links)).not.toContain("secret")
  expect(JSON.stringify(links)).not.toContain("lecture")
})

// Les deux DERNIERS seaux de la fenêtre courante, calculés plutôt
// qu'écrits en dur : la fenêtre glisse avec l'horloge, et des dates fixes
// rendraient ce test juste aujourd'hui et faux le mois prochain — sans
// que personne ne l'ait touché.
function derniersSeaux() {
  const buckets = fenetreFor("mois", Date.now()).buckets
  return { avantHier: buckets.at(-2)!, hier: buckets.at(-1)! }
}

function stubSite() {
  const { avantHier, hier } = derniersSeaux()
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
            { x: avantHier, y: 5 },
            { x: hier, y: 9 },
          ],
          pageviews: [
            { x: avantHier, y: 12 },
            { x: hier, y: 20 },
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
  // La série est DENSE : trente seaux, dont vingt-huit à zéro. Umami n'en
  // rend que deux — il omet les intervalles vides — et les deux derniers
  // portent bien ce qu'il a rendu.
  const { avantHier, hier } = derniersSeaux()
  expect(result.series).toHaveLength(30)
  expect(result.series?.slice(-2)).toEqual([
    { date: avantHier, visitors: 5, pageviews: 12 },
    { date: hier, visitors: 9, pageviews: 20 },
  ])
  // `/metrics` compte des VISITES : une visite par session, là où
  // `/stats?path=` compte chaque affichage. Mesuré sur 3.3.1, `/` sortait
  // à 2 ici et à 5 vues par `/stats`.
  expect(result.topPages).toEqual([
    { label: "/blog/bienvenue", visits: 312 },
    { label: "/", visits: 189 },
  ])
  // Umami rend le referrer vide pour un accès direct. Le laisser vide
  // afficherait une ligne sans étiquette, illisible.
  expect(result.topReferrers).toEqual([
    { label: "google.com", visits: 128 },
    { label: "Accès direct", visits: 94 },
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

  // Le drapeau est explicite, pas obligatoire : `comparison` est rempli
  // avec ou sans lui sur 3.3.1. Ce test le fige quand même, pour qu'un
  // changement de défaut chez Umami casse un test plutôt que les
  // tendances affichées.
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
  // connexion. `umamiLinks` ne rend plus que cette adresse-là : régler
  // Umami se fait depuis Umami, et le lien « administrer » qui doublait
  // celui-ci a été retiré de l'écran.
  expect(links).toEqual({
    dashboard: "https://umami.exemple.test/share/astrotan-demo",
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
  expect(links?.dashboard).toBe("https://umami.exemple.test")
  expect(links?.shared).toBe(false)
})

test("ssoLink refuse un éditeur — le lien prête un compte partagé", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()

  // Les chiffres sont ouverts aux trois rôles ; ce lien-ci ouvre une
  // session Umami avec le compte configuré, donc tout ce que ce compte
  // peut y faire. Ce n'est pas la même chose, et ce n'est pas le même
  // périmètre.
  await expect(
    editor.identity.action(api.analytics.ssoLink, {}),
  ).rejects.toThrow()
})

test("ssoLink frappe un jeton d'échange et construit le lien", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  configure()

  const posts: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url)
      posts.push(u)
      if (u.includes("/api/auth/login")) {
        return { ok: true, status: 200, json: async () => ({ token: "compte" }) }
      }
      return { ok: true, status: 200, json: async () => ({ token: "echange/+jeton" }) }
    }),
  )

  const link = await admin.identity.action(api.analytics.ssoLink, {})

  // `url` est obligatoire : sans lui, la page `/sso` consomme le jeton et
  // s'arrête sur un écran vide. Elle vise le site mesuré, pas l'accueil
  // d'Umami — on vient de l'éditeur d'un site précis.
  expect(link).toBe(
    "https://umami.exemple.test/sso?url=%2Fwebsites%2Fsite-1&token=echange%2F%2Bjeton",
  )
  // Ce qui voyage est le jeton d'ÉCHANGE, jamais celui du compte.
  expect(link).not.toContain("compte")
  expect(posts.some((u) => u.includes("/api/auth/sso"))).toBe(true)
})

test("sans Redis, Umami refuse et le lien vaut null plutôt que de casser", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  configure()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("/api/auth/login")
        ? { ok: true, status: 200, json: async () => ({ token: "compte" }) }
        : // « Redis is disabled » : la route existe mais son magasin de
          // jetons manque. L'interface doit alors proposer la connexion
          // normale, pas afficher une erreur.
          { ok: false, status: 500, json: async () => ({}) },
    ),
  )

  expect(await admin.identity.action(api.analytics.ssoLink, {})).toBeNull()
})


test("les deux séries sont appariées par leur date, jamais par leur indice", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  const buckets = fenetreFor("mois", Date.now()).buckets

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes("/api/auth/login")) {
        return { ok: true, status: 200, json: async () => ({ token: "jeton" }) }
      }
      if (u.includes("/pageviews")) {
        return {
          ok: true,
          status: 200,
          // Umami construit les deux tableaux séparément. Ici aucune session
          // ne DÉBUTE le 2 : `sessions` n'a que deux entrées pour trois
          // jours de vues. Apparier par indice collerait les 9 visiteurs du
          // 3 sur la journée du 2.
          json: async () => ({
            pageviews: [
              { x: buckets.at(-3), y: 12 },
              { x: buckets.at(-2), y: 20 },
              { x: buckets.at(-1), y: 30 },
            ],
            sessions: [
              { x: buckets.at(-3), y: 5 },
              { x: buckets.at(-1), y: 9 },
            ],
          }),
        }
      }
      if (u.includes("type=path") || u.includes("type=referrer")) {
        return { ok: true, status: 200, json: async () => [] }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ pageviews: 62, visitors: 14, comparison: { pageviews: 0, visitors: 0 } }),
      }
    }),
  )

  const result = await editor.identity.action(api.analytics.siteSummary, {})
  expect(result.series?.slice(-3)).toEqual([
    { date: buckets.at(-3), visitors: 5, pageviews: 12 },
    // Le jour sans session ouverte vaut zéro visiteur, et ne décale rien.
    { date: buckets.at(-2), visitors: 0, pageviews: 20 },
    { date: buckets.at(-1), visitors: 9, pageviews: 30 },
  ])
})

// --- La granularité : jour / mois / année --------------------------------

// Un `now` figé, et jamais `Date.now()` : une fenêtre calculée sur
// l'horloge réelle rendrait ces assertions justes aujourd'hui et fausses
// le mois prochain, ce qui est la pire des deux façons d'échouer.
const NOW = Date.UTC(2026, 7, 29, 14, 23, 45, 678) // 29 août 2026, 14 h 23 UTC

test("fenetreFor : 7 seaux journaliers, alignés sur minuit UTC", () => {
  const f = fenetreFor("semaine", NOW)
  expect(f.unit).toBe("day")
  expect(f.buckets).toHaveLength(7)
  // Le dernier seau est le jour courant, le premier 6 jours plus tôt —
  // sept seaux COMPLETS, pas sept jours glissants dont le premier serait
  // tronqué au milieu.
  expect(f.buckets.at(-1)).toBe("2026-08-29T00:00:00Z")
  expect(f.buckets[0]).toBe("2026-08-23T00:00:00Z")
  expect(f.startAt).toBe(Date.UTC(2026, 7, 23))
  expect(f.endAt).toBe(NOW)
})

test("fenetreFor : 30 seaux journaliers — même pas que la semaine, fenêtre plus longue", () => {
  const f = fenetreFor("mois", NOW)
  expect(f.unit).toBe("day")
  expect(f.buckets).toHaveLength(30)
  expect(f.buckets.at(-1)).toBe("2026-08-29T00:00:00Z")
  // Le seau le plus ancien traverse le changement de mois : `Date.UTC`
  // normalise un quantième négatif, là où une soustraction sur le jour
  // seul aurait rendu le 1er août.
  expect(f.buckets[0]).toBe("2026-07-31T00:00:00Z")
})

test("fenetreFor : « 1 an » vaut 12 seaux MENSUELS, jamais un seau annuel", () => {
  // Un seul seau annuel rendrait un point unique, et `CourbeAudience`
  // refuse de tracer sous deux points : l'écran afficherait « pas encore
  // assez de mesures » sur une année pleine de trafic.
  const f = fenetreFor("annee", NOW)
  expect(f.unit).toBe("month")
  expect(f.buckets).toHaveLength(12)
  expect(f.buckets.at(-1)).toBe("2026-08-01T00:00:00Z")
  // Le passage d'année se fait par `Date.UTC(y, m - 11, 1)`, qui normalise
  // un mois négatif — écrire `(m - 11 + 12) % 12` aurait rendu septembre
  // 2026 au lieu de septembre 2025.
  expect(f.buckets[0]).toBe("2025-09-01T00:00:00Z")
})

/** Un site qui répond, avec une seule journée de trafic dans le seau demandé. */
function stubGranularite(urls: string[]) {
  return vi.fn(async (url: string) => {
    const u = String(url)
    urls.push(u)
    if (u.includes("/api/auth/login")) {
      return { ok: true, status: 200, json: async () => ({ token: "jeton" }) }
    }
    if (u.includes("/pageviews")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          pageviews: [{ x: "2026-08-01T00:00:00Z", y: 360 }],
          sessions: [{ x: "2026-08-01T00:00:00Z", y: 10 }],
        }),
      }
    }
    if (u.includes("type=path") || u.includes("type=referrer")) {
      return { ok: true, status: 200, json: async () => [] }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ pageviews: 360, visitors: 10, comparison: { pageviews: 0, visitors: 0 } }),
    }
  })
}

test("siteSummary sans argument reste sur le jour — le défaut ne bouge pas", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  const urls: string[] = []
  vi.stubGlobal("fetch", stubGranularite(urls))

  const result = await editor.identity.action(api.analytics.siteSummary, {})
  expect(result.periode).toBe("mois")
  expect(result.unit).toBe("day")
  expect(result.series).toHaveLength(30)
  expect(urls.find((u) => u.includes("/pageviews"))).toContain("unit=day")
})

test("periode=semaine demande unit=day, et rend sept seaux", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  const urls: string[] = []
  vi.stubGlobal("fetch", stubGranularite(urls))

  const result = await editor.identity.action(api.analytics.siteSummary, {
    periode: "semaine",
  })
  expect(result.periode).toBe("semaine")
  expect(result.unit).toBe("day")
  expect(urls.find((u) => u.includes("/pageviews"))).toContain("unit=day")
  expect(result.series).toHaveLength(7)
})

test("periode=mois demande unit=day, et rend trente seaux", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  const urls: string[] = []
  vi.stubGlobal("fetch", stubGranularite(urls))

  const result = await editor.identity.action(api.analytics.siteSummary, {
    periode: "mois",
  })
  expect(result.periode).toBe("mois")
  expect(result.unit).toBe("day")
  expect(urls.find((u) => u.includes("/pageviews"))).toContain("unit=day")
  expect(result.series).toHaveLength(30)
})

test("periode=annee demande unit=month, et rend douze seaux", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  const urls: string[] = []
  vi.stubGlobal("fetch", stubGranularite(urls))

  const result = await editor.identity.action(api.analytics.siteSummary, {
    periode: "annee",
  })
  expect(result.unit).toBe("month")
  // Vérifié contre Umami 3.3.1 : `unit=month` répond réellement, avec des
  // `x` au premier du mois. `unit=week` et `unit=quarter`, eux, rendent 400.
  expect(urls.find((u) => u.includes("/pageviews"))).toContain("unit=month")
  expect(result.series).toHaveLength(12)
})

test("la série est complète : les seaux sans trafic valent zéro, pas rien", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  vi.stubGlobal("fetch", stubGranularite([]))

  const result = await editor.identity.action(api.analytics.siteSummary, {
    // `annee` — c'est la fenêtre au pas du MOIS depuis que « 30 jours » a
    // remplacé « 12 mois » sur l'onglet du milieu. Ce test porte sur les
    // seaux vides d'une série mensuelle, pas sur le nom de l'onglet.
    periode: "annee",
  })
  // Umami OMET les intervalles vides au lieu de les mettre à zéro : ici un
  // seul point pour douze mois. Tracé tel quel, le graphique mentirait sur
  // les dates. Les seaux sont donc engendrés ici, et les lignes d'Umami
  // jointes dessus par leur clé.
  const aout = result.series?.find((p) => p.date === "2026-08-01T00:00:00Z")
  expect(aout).toEqual({ date: "2026-08-01T00:00:00Z", visitors: 10, pageviews: 360 })
  expect(result.series?.every((p) => typeof p.pageviews === "number")).toBe(true)
  expect(result.series?.filter((p) => p.pageviews === 0)).toHaveLength(11)
  // Du plus ancien au plus récent : un graphique lu à l'envers est un
  // graphique faux qui a l'air juste.
  const dates = result.series!.map((p) => p.date)
  expect([...dates].sort()).toEqual(dates)
})

test("la comparaison porte la MÊME fenêtre que la série — donc la même durée", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  const urls: string[] = []
  vi.stubGlobal("fetch", stubGranularite(urls))

  const result = await editor.identity.action(api.analytics.siteSummary, {
    periode: "mois",
  })

  // C'est Umami qui calcule la période précédente, et il la prend
  // immédiatement avant la fenêtre demandée, de la MÊME durée — mesuré
  // contre 3.3.1 : une fenêtre de six heures vide rendait `comparison` à
  // 278 vues, exactement ce que rend la mesure directe des six heures
  // d'avant. Le seul moyen de casser cette propriété serait de donner à
  // `/stats` une fenêtre différente de celle de la série ; c'est cela que
  // ce test verrouille.
  const stats = urls.find((u) => u.includes("/stats"))!
  expect(stats).toContain(`startAt=${result.startAt}`)
  expect(stats).toContain(`endAt=${result.endAt}`)
  expect(stats).toContain("compare=prev")
  const pageviews = urls.find((u) => u.includes("/pageviews"))!
  expect(pageviews).toContain(`startAt=${result.startAt}`)
})

test("le fuseau est demandé explicitement, pour figer le format des dates", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  const urls: string[] = []
  vi.stubGlobal("fetch", stubGranularite(urls))

  await editor.identity.action(api.analytics.siteSummary, {})

  // Sans `timezone`, Umami 3.3.1 agrège en UTC et rend `2026-08-28T00:00:00Z`
  // — vérifié identique à `timezone=UTC`. Avec un fuseau nommé, il rend
  // `2026-08-01 00:00:00`, sans indicateur de fuseau : passé à `new Date`,
  // ce format est lu en heure LOCALE du navigateur et décale le graphique
  // d'un cran pour une partie des lecteurs. Le demander explicitement en
  // UTC est ce qui empêche un changement de défaut chez Umami de produire
  // ce décalage sans que rien n'échoue.
  expect(urls.find((u) => u.includes("/pageviews"))).toContain("timezone=UTC")
})

test("une période inconnue est refusée par le validateur, pas interprétée", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  configure()
  vi.stubGlobal("fetch", stubGranularite([]))

  // Un `v.union` de littéraux, jamais `v.string()` : une chaîne libre
  // laisserait « trimestre » arriver jusqu'au calcul de fenêtre, où elle
  // deviendrait silencieusement un défaut. L'exemple était « semaine »
  // avant qu'elle ne devienne une période réelle — un test dont la valeur
  // invalide devient valide passe au vert sans rien vérifier.
  await expect(
    editor.identity.action(api.analytics.siteSummary, { periode: "trimestre" } as never),
  ).rejects.toThrow()
})

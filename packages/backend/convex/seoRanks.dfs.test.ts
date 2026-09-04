import { afterEach, beforeEach, expect, test, vi } from "vitest"
import schema from "./schema"
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
  process.env.DATAFORSEO_LOGIN = "login@exemple.fr"
  process.env.DATAFORSEO_PASSWORD = "secret"
  delete process.env.WEB_SITE_URL
})

afterEach(() => {
  process.env = originalEnv
  vi.unstubAllGlobals()
})

async function ownerOf() {
  const t = makeTestConvex()
  const email = `dfs-${Date.now()}-${Math.random()}@example.com`
  const user = await seedUser(t, {
    email,
    password: "correct horse battery staple dfs",
    name: "Owner",
    role: "owner",
  })
  await signIn(t, email, "correct horse battery staple dfs")
  return { t, identity: await identityFor(t, user.id) }
}

function cibleDuBody(init?: { body?: string }): string {
  try {
    return JSON.parse(String(init?.body ?? "[]"))[0]?.target ?? ""
  } catch {
    return ""
  }
}

function stubDfs(opts: {
  labsPour?: Record<string, unknown[]>
  overviewPour?: Record<string, { backlinks: number; referring_domains: number }>
  statusPour?: Record<string, number>
  record?: string[]
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const target = cibleDuBody(init)
      opts.record?.push(`${String(url).includes("ranked_keywords") ? "labs" : "ov"}:${target}`)
      const code = opts.statusPour?.[target] ?? 20000
      if (code !== 20000) {
        return { ok: true, json: async () => ({ status_code: code }) }
      }
      if (String(url).includes("ranked_keywords")) {
        const items = opts.labsPour?.[target] ?? []
        return {
          ok: true,
          json: async () => ({
            status_code: 20000,
            tasks: [{ status_code: 20000, result: [{ items, total_count: items.length }] }],
          }),
        }
      }
      const ov = opts.overviewPour?.[target] ?? { backlinks: 0, referring_domains: 0 }
      return {
        ok: true,
        json: async () => ({
          status_code: 20000,
          tasks: [{ status_code: 20000, result: [ov] }],
        }),
      }
    }),
  )
}

const LABS = {
  keyword_data: { keyword: "formation nocode" },
  ranked_serp_element: {
    serp_item: { rank_absolute: 6, url: "https://agence-dupont.fr/" },
  },
}

test("refreshSite : www déclaré → on interroge l'apex d'abord (doc DFS)", async () => {
  const { t, identity } = await ownerOf()
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      siteName: "Test",
      declaredDomain: "www.agence-dupont.fr",
    }),
  )
  const record: string[] = []
  stubDfs({
    record,
    labsPour: { "agence-dupont.fr": [LABS], "www.agence-dupont.fr": [] },
    overviewPour: {
      "agence-dupont.fr": { backlinks: 9, referring_domains: 3 },
      "www.agence-dupont.fr": { backlinks: 0, referring_domains: 0 },
    },
  })
  expect(await identity.action(api.seoRanks.refreshSite, {})).toMatchObject({ ok: true })
  expect(record.filter((l) => l.startsWith("labs:"))[0]).toBe("labs:agence-dupont.fr")
  const keys = await t.run((ctx) => ctx.db.query("seoSiteKeywords").collect())
  expect(keys.map((k) => k.keyword)).toEqual(["formation nocode"])
  const links = await t.run((ctx) => ctx.db.query("seoSiteBacklinks").first())
  expect(links?.backlinks).toBe(9)
  const hist = await t.run((ctx) => ctx.db.query("seoSiteHistory").collect())
  expect(hist.some((h) => h.metric === "keywords" && h.value === 1)).toBe(true)
  expect(hist.some((h) => h.metric === "backlinks" && h.value === 9)).toBe(true)
})

test("refreshSite : total_count > 0 sans items parsables → échec, pas un faux 0", async () => {
  const { t, identity } = await ownerOf()
  await t.run((ctx) =>
    ctx.db.insert("settings", { siteName: "Test", declaredDomain: "studio-nord.fr" }),
  )
  stubDfs({
    labsPour: { "studio-nord.fr": [{}], "www.studio-nord.fr": [{}] },
    overviewPour: {
      "studio-nord.fr": { backlinks: 81, referring_domains: 54 },
      "www.studio-nord.fr": { backlinks: 81, referring_domains: 54 },
    },
  })
  expect(await identity.action(api.seoRanks.refreshSite, {})).toEqual({
    ok: false,
    reason: "keywords",
  })
  expect(await t.run((ctx) => ctx.db.query("seoSiteKeywords").collect())).toHaveLength(0)
  const links = await t.run((ctx) => ctx.db.query("seoSiteBacklinks").first())
  expect(links?.backlinks).toBe(81)
})

test("refreshSite : 40100 / 40201 / 40400 n'écrivent pas un faux zéro", async () => {
  const { t, identity } = await ownerOf()
  await t.run((ctx) =>
    ctx.db.insert("settings", { siteName: "Test", declaredDomain: "autre-site.be" }),
  )
  stubDfs({ statusPour: { "autre-site.be": 40100, "www.autre-site.be": 40100 } })
  expect(await identity.action(api.seoRanks.refreshSite, {})).toEqual({
    ok: false,
    reason: "unreachable",
  })
  expect(await t.run((ctx) => ctx.db.query("seoSiteKeywords").collect())).toHaveLength(0)
  expect(await t.run((ctx) => ctx.db.query("seoSiteBacklinks").first())).toBeNull()
})

test("refreshSite : vrai 0 apex, données www → on écrit www ; locale Paris", async () => {
  const { t, identity } = await ownerOf()
  await t.run((ctx) =>
    ctx.db.insert("settings", {
      siteName: "Test",
      declaredDomain: "studio-nord.fr",
      serpLocationCode: 1006094,
      serpLanguageCode: "fr",
    }),
  )
  const record: string[] = []
  stubDfs({
    record,
    labsPour: {
      "studio-nord.fr": [],
      "www.studio-nord.fr": [LABS],
    },
    overviewPour: {
      "studio-nord.fr": { backlinks: 0, referring_domains: 0 },
      "www.studio-nord.fr": { backlinks: 4, referring_domains: 2 },
    },
  })
  expect(await identity.action(api.seoRanks.refreshSite, {})).toMatchObject({ ok: true })
  expect(record.some((l) => l === "labs:www.studio-nord.fr")).toBe(true)
  const keys = await t.run((ctx) => ctx.db.query("seoSiteKeywords").collect())
  expect(keys.map((k) => k.keyword)).toEqual(["formation nocode"])
  const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
  const labsBody = JSON.parse(
    String(
      fetchMock.mock.calls.find((c) => String(c[0]).includes("ranked_keywords"))?.[1]
        ?.body ?? "[]",
    ),
  )[0]
  expect(labsBody.location_code).toBe(1006094)
  expect(labsBody.language_code).toBe("fr")
})

import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
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
})

afterEach(() => {
  process.env = originalEnv
})

async function seedOwner(t: TestConvex<typeof schema>) {
  const email = `series-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple series"
  const user = await seedUser(t, { email, password, name: "Owner", role: "owner" })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

test("siteSeries refuse un appelant sans session", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.seoRanks.siteSeries, { periode: "mois" })).rejects.toThrow()
})

test("sans historique : le snapshot courant est l'unique point", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  process.env.DATAFORSEO_LOGIN = "login@exemple.fr"
  process.env.DATAFORSEO_PASSWORD = "secret"
  const maintenant = Date.now()
  await t.run((ctx) =>
    ctx.db.insert("seoSiteBacklinks", {
      backlinks: 42,
      referringDomains: 12,
      fetchedAt: maintenant,
    }),
  )
  const series = await owner.identity.query(api.seoRanks.siteSeries, {
    periode: "mois",
  })
  expect(series.backlinks).toEqual([{ fetchedAt: maintenant, value: 42 }])
  expect(series.keywords).toEqual([])
  expect(series.position).toEqual([])
})

test("n'invente pas de point entre deux relevés hors fenêtre", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  const hors = Date.now() - 90 * 24 * 60 * 60 * 1000
  await t.run((ctx) =>
    ctx.db.insert("seoSiteHistory", {
      metric: "backlinks",
      value: 10,
      fetchedAt: hors,
    }),
  )
  const series = await owner.identity.query(api.seoRanks.siteSeries, {
    periode: "semaine",
  })
  expect(series.backlinks).toEqual([])
})

test("recordPositionHistory écrit la moyenne des ranked", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  process.env.DATAFORSEO_LOGIN = "login@exemple.fr"
  process.env.DATAFORSEO_PASSWORD = "secret"
  const id = await t.run((ctx) =>
    ctx.db.insert("pages", {
      slug: "contact",
      title: "Contact",
      status: "published",
      targetKeyword: "agence",
      createdBy: owner.id,
      updatedBy: owner.id,
    }),
  )
  await t.run((ctx) =>
    ctx.db.insert("seoRanks", {
      kind: "page",
      pageId: id,
      keyword: "agence",
      url: "https://exemple.fr/contact",
      status: "ranked",
      position: 8,
      fetchedAt: 1,
    }),
  )
  const fetchedAt = Date.now()
  await t.mutation(internal.seoRanks.recordPositionHistory, { fetchedAt })
  const series = await owner.identity.query(api.seoRanks.siteSeries, {
    periode: "mois",
  })
  expect(series.position).toEqual([{ fetchedAt, value: 8 }])
})

test("replaceSiteKeywords et upsertSiteBacklinks historisent chaque fetch", async () => {
  const t = makeTestConvex()
  const fetchedAt = Date.now()
  await t.mutation(internal.seoRanks.replaceSiteKeywords, {
    rows: [
      { keyword: "agence", position: 3, url: "https://exemple.fr/" },
      { keyword: "web", position: 8, url: "https://exemple.fr/contact" },
    ],
    fetchedAt,
  })
  await t.mutation(internal.seoRanks.upsertSiteBacklinks, {
    backlinks: 42,
    referringDomains: 7,
    fetchedAt,
  })
  const rows = await t.run((ctx) => ctx.db.query("seoSiteHistory").collect())
  expect(rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ metric: "keywords", value: 2, fetchedAt }),
      expect.objectContaining({ metric: "backlinks", value: 42, fetchedAt }),
    ]),
  )
})

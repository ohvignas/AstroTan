import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
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
  delete process.env.DATAFORSEO_LOGIN
  delete process.env.DATAFORSEO_PASSWORD
})

afterEach(() => {
  process.env = originalEnv
  vi.unstubAllGlobals()
})

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor",
) {
  const email = `seoranks-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple seoranks"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

test("forDocument : no_keyword sans mot-clé", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const id = await owner.identity.mutation(api.pages.create, {
    title: "Contact",
    slug: "contact",
  })
  const rank = await owner.identity.query(api.seoRanks.forDocument, {
    kind: "page",
    pageId: id,
  })
  expect(rank.state).toBe("no_keyword")
  expect(rank.canRelever).toBe(false)
})

test("forDocument : never_ranked quand le mot-clé est posé", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  process.env.DATAFORSEO_LOGIN = "login@exemple.fr"
  process.env.DATAFORSEO_PASSWORD = "secret"
  const id = await owner.identity.mutation(api.pages.create, {
    title: "Contact",
    slug: "contact",
  })
  await owner.identity.mutation(api.pages.update, {
    id,
    targetKeyword: "agence web lyon",
  })
  const rank = await owner.identity.query(api.seoRanks.forDocument, {
    kind: "page",
    pageId: id,
  })
  expect(rank.state).toBe("never_ranked")
  expect(rank.canRelever).toBe(false)
})

test("siteSnapshot sans DFS : configured false, moyenne null", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const snap = await owner.identity.query(api.seoRanks.siteSnapshot, {})
  expect(snap.configured).toBe(false)
  expect(snap.averagePosition).toBeNull()
  expect(snap.keywords).toEqual([])
})

test("siteSnapshot : moyenne des ranked publiés qui ont encore ce mot-clé", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  process.env.DATAFORSEO_LOGIN = "login@exemple.fr"
  process.env.DATAFORSEO_PASSWORD = "secret"
  const id = await t.run((ctx) =>
    ctx.db.insert("pages", {
      slug: "contact",
      title: "Contact",
      status: "published",
      targetKeyword: "agence web lyon",
      createdBy: owner.id,
      updatedBy: owner.id,
    }),
  )
  await t.run((ctx) =>
    ctx.db.insert("seoRanks", {
      kind: "page",
      pageId: id,
      keyword: "agence web lyon",
      url: "https://exemple.fr/contact",
      status: "ranked",
      position: 8,
      previousPosition: 12,
      fetchedAt: 1,
    }),
  )
  const snap = await owner.identity.query(api.seoRanks.siteSnapshot, {})
  expect(snap.configured).toBe(true)
  expect(snap.averagePosition).toBe(8)
  expect(snap.averagePositionPrev).toBe(12)
})

function stubSerp(items: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ tasks: [{ result: [{ items }] }] }),
    })),
  )
}

async function pagePubliee(
  t: TestConvex<typeof schema>,
  ownerId: string,
  keyword = "agence web lyon",
) {
  return t.run((ctx) =>
    ctx.db.insert("pages", {
      slug: "contact",
      title: "Contact",
      status: "published",
      targetKeyword: keyword,
      createdBy: ownerId,
      updatedBy: ownerId,
    }),
  )
}

test("relever refuse un brouillon", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  process.env.DATAFORSEO_LOGIN = "login@exemple.fr"
  process.env.DATAFORSEO_PASSWORD = "secret"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  const id = await owner.identity.mutation(api.pages.create, {
    title: "Brouillon",
    slug: "brouillon",
  })
  await owner.identity.mutation(api.pages.update, {
    id,
    targetKeyword: "agence",
  })
  const result = await owner.identity.action(api.seoRanks.relever, {
    kind: "page",
    pageId: id,
  })
  expect(result).toEqual({ ok: false, reason: "draft" })
})

test("relever : succès, throttle 1 h, échec HTTP n'écrit pas", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  process.env.DATAFORSEO_LOGIN = "login@exemple.fr"
  process.env.DATAFORSEO_PASSWORD = "secret"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  const id = await pagePubliee(t, owner.id)

  stubSerp([
    { type: "organic", url: "https://exemple.fr/contact", rank_absolute: 9 },
  ])
  expect(
    await owner.identity.action(api.seoRanks.relever, { kind: "page", pageId: id }),
  ).toEqual({ ok: true })
  const row = await t.run((ctx) =>
    ctx.db
      .query("seoRanks")
      .withIndex("by_page", (q) => q.eq("pageId", id))
      .unique(),
  )
  expect(row?.status).toBe("ranked")
  expect(row?.position).toBe(9)

  expect(
    await owner.identity.action(api.seoRanks.relever, { kind: "page", pageId: id }),
  ).toEqual({ ok: false, reason: "throttled" })

  await t.run(async (ctx) => {
    if (row) await ctx.db.patch(row._id, { fetchedAt: Date.now() - 3_600_001 })
  })
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  expect(
    await owner.identity.action(api.seoRanks.relever, { kind: "page", pageId: id }),
  ).toEqual({ ok: false, reason: "unreachable" })
  const apres = await t.run((ctx) =>
    ctx.db
      .query("seoRanks")
      .withIndex("by_page", (q) => q.eq("pageId", id))
      .unique(),
  )
  expect(apres?.position).toBe(9)
})

test("relever : un editor ne relève pas le document d'autrui", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  const editor = await seedActor(t, "editor")
  process.env.DATAFORSEO_LOGIN = "login@exemple.fr"
  process.env.DATAFORSEO_PASSWORD = "secret"
  const id = await pagePubliee(t, owner.id)
  await expect(
    editor.identity.action(api.seoRanks.relever, { kind: "page", pageId: id }),
  ).rejects.toThrow(/FORBIDDEN/)
})

test("refreshWeekly saute les brouillons et copie previous*", async () => {
  const t = makeTestConvex()
  process.env.DATAFORSEO_LOGIN = "login@exemple.fr"
  process.env.DATAFORSEO_PASSWORD = "secret"
  process.env.WEB_SITE_URL = "https://exemple.fr"
  const published = await t.run((ctx) =>
    ctx.db.insert("pages", {
      slug: "contact",
      title: "Contact",
      status: "published",
      targetKeyword: "agence web lyon",
      createdBy: "u1",
      updatedBy: "u1",
    }),
  )
  await t.run((ctx) =>
    ctx.db.insert("pages", {
      slug: "brouillon",
      title: "Brouillon",
      status: "draft",
      targetKeyword: "agence web lyon",
      createdBy: "u1",
      updatedBy: "u1",
    }),
  )
  await t.run((ctx) =>
    ctx.db.insert("seoRanks", {
      kind: "page",
      pageId: published,
      keyword: "ancien",
      url: "https://exemple.fr/contact",
      status: "ranked",
      position: 20,
      fetchedAt: 1,
    }),
  )
  stubSerp([
    { type: "organic", url: "https://exemple.fr/contact", rank_absolute: 4 },
  ])
  await t.action(internal.seoRanks.refreshWeekly, {})
  const rows = await t.run((ctx) => ctx.db.query("seoRanks").collect())
  expect(rows).toHaveLength(1)
  expect(rows[0]?.pageId).toBe(published)
  expect(rows[0]?.position).toBe(4)
  expect(rows[0]?.previousPosition).toBe(20)
  expect(rows[0]?.keyword).toBe("agence web lyon")
})

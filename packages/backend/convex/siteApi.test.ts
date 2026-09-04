import { afterEach, beforeEach, expect, test } from "vitest"
import { internal } from "./_generated/api"
import { ORIGIN, makeTestConvex } from "../testing/betterAuthFixture"

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

test("PATCH d'un article publié écrit workingCopy, pas le live", async () => {
  const t = makeTestConvex()
  const id = await t.run(async (ctx) =>
    ctx.db.insert("posts", {
      slug: "live",
      title: "Titre live",
      status: "published",
      body: "<p>live</p>",
      tagIds: [],
      createdBy: "owner_1",
      updatedBy: "owner_1",
      publishedAt: 1,
    }),
  )
  await t.mutation(internal.siteApi.updatePost, {
    id,
    acteurId: "owner_1",
    title: "Titre brouillon",
  })
  const row = await t.run(async (ctx) => ctx.db.get(id))
  expect(row?.title).toBe("Titre live")
  expect(row?.workingCopy?.title).toBe("Titre brouillon")
})

test("GET d'un article publié rend l'overlay workingCopy", async () => {
  const t = makeTestConvex()
  const id = await t.run(async (ctx) =>
    ctx.db.insert("posts", {
      slug: "live",
      title: "Titre live",
      status: "published",
      body: "<p>live</p>",
      tagIds: [],
      workingCopy: {
        slug: "live",
        title: "Titre brouillon",
        body: "<p>draft</p>",
        tagIds: [],
      },
      createdBy: "owner_1",
      updatedBy: "owner_1",
      publishedAt: 1,
    }),
  )
  const got = await t.query(internal.siteApi.getPost, { id })
  expect(got?.title).toBe("Titre brouillon")
  expect(got?.hasUnpublishedChanges).toBe(true)
})

test("createPost pose un brouillon", async () => {
  const t = makeTestConvex()
  const id = await t.mutation(internal.siteApi.createPost, {
    title: "Nouveau",
    slug: "nouveau",
    acteurId: "owner_1",
  })
  const row = await t.run(async (ctx) => ctx.db.get(id))
  expect(row?.status).toBe("draft")
  expect(row?.createdBy).toBe("owner_1")
})

test("listLeads est à plat ; getLead 404 si absent", async () => {
  const t = makeTestConvex()
  await t.run(async (ctx) => {
    await ctx.db.insert("leads", {
      name: "Ada",
      email: "ada@exemple.fr",
      status: "new",
      lastMessageAt: Date.now(),
      messageCount: 1,
    })
  })
  const list = await t.query(internal.siteApi.listLeads, {})
  expect(list).toHaveLength(1)
  expect(list[0]?.email).toBe("ada@exemple.fr")
  await expect(
    t.query(internal.siteApi.getLead, {
      id: "kd000000000000000000000000000000" as never,
    }),
  ).rejects.toThrow()
})

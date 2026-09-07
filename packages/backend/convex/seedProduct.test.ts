import { afterEach, beforeEach, expect, test } from "vitest"
import { internal } from "./_generated/api"
import { makeTestConvex } from "../testing/betterAuthFixture"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = "http://localhost:3001"
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  delete process.env.DEMO_SANDBOX
})

afterEach(() => {
  process.env = originalEnv
})

test("hors bac à sable, productArticles ne crée rien", async () => {
  const t = makeTestConvex()
  const out = await t.mutation(internal.seedProduct.productArticles, {})
  expect(out).toEqual({ skipped: true })
  const posts = await t.run(async (ctx) => ctx.db.query("posts").collect())
  expect(posts).toHaveLength(0)
})

test("sur le bac à sable, crée les deux articles publiés et dépublie les seed", async () => {
  process.env.DEMO_SANDBOX = "true"
  const t = makeTestConvex()
  await t.mutation(internal.seed.demoContent, {})
  const out = await t.mutation(internal.seedProduct.productArticles, {})
  expect(out).toMatchObject({ skipped: false, created: 2 })

  const posts = await t.run(async (ctx) => ctx.db.query("posts").collect())
  const bySlug = Object.fromEntries(posts.map((p) => [p.slug, p]))
  expect(bySlug["astrotan-site-vitrine-cms"]?.status).toBe("published")
  expect(bySlug["site-vitrine-sans-wordpress"]?.status).toBe("published")
  expect(bySlug["astrotan-site-vitrine-cms"]?.targetKeyword).toBe("AstroTan CMS")
  expect(bySlug["site-vitrine-sans-wordpress"]?.targetKeyword).toBe(
    "site vitrine sans WordPress",
  )
  expect(bySlug.bienvenue?.status).toBe("draft")
  expect(bySlug["markdown-et-mise-en-forme"]?.status).toBe("draft")
})

test("genererSeo ne parle pas à OpenRouter hors bac à sable", async () => {
  const t = makeTestConvex()
  const out = await t.action(internal.seedProductAi.genererSeo, {})
  expect(out).toMatchObject({ skipped: true, results: [] })
})

test("productArticles est idempotent par slug", async () => {
  process.env.DEMO_SANDBOX = "true"
  const t = makeTestConvex()
  await t.mutation(internal.seedProduct.productArticles, {})
  const second = await t.mutation(internal.seedProduct.productArticles, {})
  expect(second).toMatchObject({ skipped: false, created: 0 })
  const posts = await t.run(async (ctx) =>
    ctx.db
      .query("posts")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .collect(),
  )
  expect(posts).toHaveLength(2)
})

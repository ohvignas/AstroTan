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
const OWNER_EMAIL = "owner@astrotan.invalid"
const OWNER_PASSWORD = "correct horse battery staple owner"

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

async function trouverParEmail(t: ReturnType<typeof makeTestConvex>, email: string) {
  const doc = await t.run((ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "email", operator: "eq", value: email }],
    }),
  )
  return doc as { _id: string } | null
}

function insertPost(
  t: ReturnType<typeof makeTestConvex>,
  createdBy: string,
  slug: string,
) {
  return t.run((ctx) =>
    ctx.db.insert("posts", {
      slug,
      title: slug,
      excerpt: "Chapô.",
      body: "<p>Corps.</p>",
      status: "draft",
      tagIds: [],
      createdBy,
      updatedBy: createdBy,
    }),
  )
}

test("restaurer saute quand le flag est éteint et ne touche aucun article", async () => {
  const t = makeTestConvex()
  const owner = await seedUser(t, {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    name: "Owner",
    role: "owner",
  })
  await insertPost(t, owner.id, "reste-en-place")

  expect(await t.mutation(internal.demo.restaurer, {})).toEqual({ skipped: true })

  const posts = await t.run((ctx) => ctx.db.query("posts").collect())
  expect(posts).toHaveLength(1)
  expect(posts[0]?.slug).toBe("reste-en-place")
})

test("restaurer efface les articles démo, garde ceux de l'owner et les pages", async () => {
  const t = makeTestConvex()
  activerSandbox()
  const owner = await seedUser(t, {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    name: "Owner",
    role: "owner",
  })
  await t.mutation(internal.demo.seedSandbox, {})
  const demo = await trouverParEmail(t, DEMO_EMAIL)
  expect(demo).not.toBeNull()

  await t.mutation(internal.seed.demoContent, {})
  const pagesAvant = await t.run((ctx) => ctx.db.query("pages").collect())
  expect(pagesAvant.length).toBeGreaterThan(0)

  await insertPost(t, demo!._id, "brouillon-demo-un")
  await insertPost(t, demo!._id, "brouillon-demo-deux")
  await insertPost(t, owner.id, "article-owner")

  expect(await t.mutation(internal.demo.restaurer, {})).toEqual({ skipped: false })

  const postsDemo = await t.run((ctx) =>
    ctx.db
      .query("posts")
      .withIndex("by_created_by", (q) => q.eq("createdBy", demo!._id))
      .collect(),
  )
  expect(postsDemo).toHaveLength(0)

  const postsOwner = await t.run((ctx) =>
    ctx.db
      .query("posts")
      .withIndex("by_created_by", (q) => q.eq("createdBy", owner.id))
      .collect(),
  )
  expect(postsOwner.some((p) => p.slug === "article-owner")).toBe(true)

  const pagesApres = await t.run((ctx) => ctx.db.query("pages").collect())
  expect(pagesApres.map((p) => p._id).sort()).toEqual(pagesAvant.map((p) => p._id).sort())
})

test("restaurer révoque la session démo ; un nouveau sign-in fonctionne", async () => {
  const t = makeTestConvex()
  activerSandbox()
  await seedUser(t, {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    name: "Owner",
    role: "owner",
  })
  await t.mutation(internal.demo.seedSandbox, {})
  const demo = await trouverParEmail(t, DEMO_EMAIL)
  expect(demo).not.toBeNull()

  await signIn(t, DEMO_EMAIL, DEMO_PASSWORD)
  const avant = await identityFor(t, demo!._id)
  expect(await avant.query(api.demo.jeSuisDemo, {})).toBe(true)

  await t.mutation(internal.demo.restaurer, {})

  await expect(identityFor(t, demo!._id)).rejects.toThrow(/no session/)
  expect(await avant.query(api.demo.jeSuisDemo, {})).toBe(false)

  await signIn(t, DEMO_EMAIL, DEMO_PASSWORD)
  const apres = await identityFor(t, demo!._id)
  expect(await apres.query(api.demo.jeSuisDemo, {})).toBe(true)
})

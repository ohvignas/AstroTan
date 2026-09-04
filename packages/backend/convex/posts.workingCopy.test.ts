import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
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
})

afterEach(() => {
  process.env = originalEnv
})

async function seedOwner(t: TestConvex<typeof schema>) {
  const email = `wc-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple wc"
  const user = await seedUser(t, { email, password, name: "Owner", role: "owner" })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

async function outboxRows(t: TestConvex<typeof schema>) {
  return t.run((ctx) => ctx.db.query("revalidationOutbox").collect())
}

test("update d'un publié écrit la working copy, pas la ligne publique", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  const id = await owner.identity.mutation(api.posts.create, {
    title: "En ligne",
    slug: "en-ligne",
  })
  await owner.identity.mutation(api.posts.publishPost, { id })
  const apresPublication = (await outboxRows(t)).length

  await owner.identity.mutation(api.posts.update, {
    id,
    title: "Titre inédit",
    body: "<p>Corps inédit</p>",
  })

  const row = await t.run((ctx) => ctx.db.get(id))
  expect(row?.title).toBe("En ligne")
  expect(row?.body).toBe("")
  expect(row?.workingCopy?.title).toBe("Titre inédit")
  expect(row?.workingCopy?.body).toBe("<p>Corps inédit</p>")
  expect(await t.query(api.posts.getPublishedPost, { slug: "en-ligne" })).toMatchObject({
    title: "En ligne",
    body: "",
  })
  expect((await outboxRows(t)).length).toBe(apresPublication)

  const editor = await owner.identity.query(api.posts.get, { id })
  expect(editor?.title).toBe("Titre inédit")
  expect(editor?.hasUnpublishedChanges).toBe(true)
})

test("publishPost copie la working copy vers le live et invalide", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  const id = await owner.identity.mutation(api.posts.create, {
    title: "En ligne",
    slug: "en-ligne-pub",
  })
  await owner.identity.mutation(api.posts.publishPost, { id })
  await owner.identity.mutation(api.posts.update, { id, title: "Titre inédit" })
  const avant = (await outboxRows(t)).length

  await owner.identity.mutation(api.posts.publishPost, { id })

  const row = await t.run((ctx) => ctx.db.get(id))
  expect(row?.title).toBe("Titre inédit")
  expect(row?.workingCopy).toBeUndefined()
  expect(row?.status).toBe("published")
  expect((await t.query(api.posts.getPublishedPost, { slug: "en-ligne-pub" }))?.title).toBe(
    "Titre inédit",
  )
  expect((await outboxRows(t)).length).toBe(avant + 1)
  expect((await owner.identity.query(api.posts.get, { id }))?.hasUnpublishedChanges).toBe(
    false,
  )
})

test("discardWorkingCopy jette la working copy et rend le live", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  const id = await owner.identity.mutation(api.posts.create, {
    title: "En ligne",
    slug: "en-ligne-annuler",
  })
  await owner.identity.mutation(api.posts.publishPost, { id })
  await owner.identity.mutation(api.posts.update, { id, title: "Titre inédit" })

  const rendered = await owner.identity.mutation(api.posts.discardWorkingCopy, { id })
  expect(rendered.title).toBe("En ligne")
  expect(rendered.hasUnpublishedChanges).toBe(false)

  const row = await t.run((ctx) => ctx.db.get(id))
  expect(row?.title).toBe("En ligne")
  expect(row?.workingCopy).toBeUndefined()
  expect((await t.query(api.posts.getPublishedPost, { slug: "en-ligne-annuler" }))?.title).toBe(
    "En ligne",
  )
})

test("publishPost d'un brouillon sans working copy reste le geste actuel", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Brouillon",
    slug: "brouillon-pub",
  })
  await owner.identity.mutation(api.posts.update, {
    id,
    body: "<p>Corps</p>",
  })
  await owner.identity.mutation(api.posts.publishPost, { id })

  const row = await t.run((ctx) => ctx.db.get(id))
  expect(row?.status).toBe("published")
  expect(row?.title).toBe("Brouillon")
  expect(row?.body).toBe("<p>Corps</p>")
  expect(row?.workingCopy).toBeUndefined()
})

test("renommer dans la working copy ne crée pas de 301 ; publier le fait", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  const id = await owner.identity.mutation(api.posts.create, {
    title: "Article",
    slug: "titre-v1",
  })
  await owner.identity.mutation(api.posts.publishPost, { id })
  await owner.identity.mutation(api.posts.update, { id, slug: "titre-v2" })

  expect(await t.query(api.redirects.listActive, {})).toEqual([])
  expect((await t.run((ctx) => ctx.db.get(id)))?.slug).toBe("titre-v1")

  await owner.identity.mutation(api.posts.publishPost, { id })

  expect(await t.query(api.redirects.listActive, {})).toContainEqual({
    from: "blog/titre-v1",
    to: "/blog/titre-v2",
    code: 301,
  })
  const tags = (await outboxRows(t)).at(-1)?.tags
  expect(tags).toEqual(expect.arrayContaining(["posts", "post:titre-v1", "post:titre-v2"]))
})

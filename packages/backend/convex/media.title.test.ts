import { afterEach, beforeEach, expect, test } from "vitest"
import type { TestConvex } from "convex-test"
import schema from "./schema"
import { api } from "./_generated/api"
import { MAX_MEDIA_TITLE_LENGTH } from "./content"
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
  const email = `media-title-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple media title"
  const user = await seedUser(t, { email, password, name: "Owner", role: "owner" })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

const VALID = {
  filename: "une.png",
  mime: "image/png",
  size: 12,
  alt: "Vitrine rénovée",
}

test("register accepte un title optionnel", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["x"])))
  const id = await owner.identity.mutation(api.media.register, {
    ...VALID,
    storageId,
    title: "Rénover une vitrine",
  })
  expect((await t.run((ctx) => ctx.db.get(id)))?.title).toBe("Rénover une vitrine")
})

test("register refuse un title au-delà de sa borne", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["x"])))
  await expect(
    owner.identity.mutation(api.media.register, {
      ...VALID,
      storageId,
      title: "x".repeat(MAX_MEDIA_TITLE_LENGTH + 1),
    }),
  ).rejects.toMatchObject({ data: { code: "FIELD_TOO_LONG", field: "title" } })
})

test("publicCaption rend alt et title sans session", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["x"])))
  await owner.identity.mutation(api.media.register, {
    ...VALID,
    storageId,
    title: "Rénover une vitrine",
  })
  expect(await t.query(api.media.publicCaption, { storageId })).toEqual({
    alt: VALID.alt,
    title: "Rénover une vitrine",
  })
})

test("update pose le title sans toucher à l'alt", async () => {
  const t = makeTestConvex()
  const owner = await seedOwner(t)
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["x"])))
  const id = await owner.identity.mutation(api.media.register, {
    ...VALID,
    storageId,
  })
  await owner.identity.mutation(api.media.update, { id, title: "Titre hover" })
  const row = await t.run((ctx) => ctx.db.get(id))
  expect(row?.title).toBe("Titre hover")
  expect(row?.alt).toBe(VALID.alt)
})

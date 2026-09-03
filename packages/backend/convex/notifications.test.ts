import { afterEach, beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import { ORIGIN, identityFor, makeTestConvex, seedUser, signIn } from "../testing/betterAuthFixture"
import type { TestConvex } from "convex-test"
import type schema from "./schema"

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

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor",
) {
  const email = `notif-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple notif"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id, email }
}

test("sans ligne, mesPrefs rend les défauts du rôle", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const prefs = await editor.identity.query(api.notifications.mesPrefs, {})
  const lead = prefs.find((p) => p.cle === "leadNotification")!
  expect(lead.cloche).toBe(true)
  expect(lead.email).toBe(false)
  const post = prefs.find((p) => p.cle === "postPublished")!
  expect(post.cloche).toBe(true)
  expect(post.email).toBe(false)
})

test("setPrefs n'écrit que la session, jamais un autre authUserId", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await owner.identity.mutation(api.notifications.setPrefs, {
    cle: "leadNotification",
    cloche: true,
    email: false,
  })
  const rows = await t.run((ctx) => ctx.db.query("notificationPrefs").collect())
  expect(rows).toHaveLength(1)
  expect(rows[0]!.authUserId).toBe(owner.id)
  expect(rows[0]!.email).toBe(false)
})

test("marquerLu d'autrui est NOT_FOUND ; déjà lu est no-op", async () => {
  const t = makeTestConvex()
  const a = await seedActor(t, "owner")
  const b = await seedActor(t, "admin")
  const id = await t.run((ctx) =>
    ctx.db.insert("notifications", {
      authUserId: a.id,
      cle: "leadNotification",
      titre: "Nouveau message de contact",
    }),
  )
  await expect(b.identity.mutation(api.notifications.marquerLu, { id })).rejects.toMatchObject({
    data: { code: "NOT_FOUND" },
  })
  await a.identity.mutation(api.notifications.marquerLu, { id })
  const premiere = await t.run((ctx) => ctx.db.get(id))
  expect(premiere!.readAt).toEqual(expect.any(Number))
  await a.identity.mutation(api.notifications.marquerLu, { id })
  const seconde = await t.run((ctx) => ctx.db.get(id))
  expect(seconde!.readAt).toBe(premiere!.readAt)
})

test("marquerToutesLues marque les siennes, pas celles d'autrui ; déjà lu est no-op", async () => {
  const t = makeTestConvex()
  const a = await seedActor(t, "owner")
  const b = await seedActor(t, "admin")
  const [idA1, idA2, idB] = await t.run(async (ctx) => {
    const a1 = await ctx.db.insert("notifications", {
      authUserId: a.id,
      cle: "leadNotification",
      titre: "Nouveau message de contact",
    })
    const a2 = await ctx.db.insert("notifications", {
      authUserId: a.id,
      cle: "leadNotification",
      titre: "Nouveau chat sur le site",
    })
    const other = await ctx.db.insert("notifications", {
      authUserId: b.id,
      cle: "leadNotification",
      titre: "Nouveau message de contact",
    })
    return [a1, a2, other]
  })
  await a.identity.mutation(api.notifications.marquerLu, { id: idA1 })
  const dejaLu = await t.run((ctx) => ctx.db.get(idA1))
  await a.identity.mutation(api.notifications.marquerToutesLues, {})
  const [apresA1, apresA2, apresB] = await t.run((ctx) =>
    Promise.all([ctx.db.get(idA1), ctx.db.get(idA2), ctx.db.get(idB)]),
  )
  expect(apresA1!.readAt).toBe(dejaLu!.readAt)
  expect(apresA2!.readAt).toEqual(expect.any(Number))
  expect(apresB!.readAt).toBeUndefined()
  const { lignes, nonLues } = await a.identity.query(api.notifications.liste, {})
  expect(nonLues).toBe(0)
  expect(lignes).toHaveLength(0)
})

test("liste rend 30 lignes max et nonLues", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  await t.run(async (ctx) => {
    for (let i = 0; i < 31; i++) {
      await ctx.db.insert("notifications", {
        authUserId: owner.id,
        cle: "leadNotification",
        titre: `n${i}`,
      })
    }
  })
  const { lignes, nonLues } = await owner.identity.query(api.notifications.liste, {})
  expect(lignes).toHaveLength(30)
  expect(nonLues).toBe(31)
})

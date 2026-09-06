import { afterEach, beforeEach, expect, test } from "vitest"
import { internal } from "./_generated/api"
import { makeTestConvex } from "../testing/betterAuthFixture"

// Un déploiement neuf a déjà WEB_DOMAIN (bootstrap l'a posé, le DNS
// aussi) — mais `seed:demoContent` n'écrivait que le nom du site. L'écran
// `/settings/domaine` restait donc vide alors que les A existaient déjà.
// Ces tests gardent le rattrapage : le seed pose `declaredDomain` depuis
// l'environnement, et il ne touche jamais un domaine déjà saisi.

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = "http://localhost:3001"
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  delete process.env.WEB_DOMAIN
  delete process.env.WEB_SITE_URL
})

afterEach(() => {
  process.env = originalEnv
})

test("le seed pose declaredDomain depuis WEB_DOMAIN quand la ligne est neuve", async () => {
  process.env.WEB_DOMAIN = "AstroTan.Illith.com"
  const t = makeTestConvex()
  await t.mutation(internal.seed.demoContent, {})
  const ligne = await t.run(async (ctx) => ctx.db.query("settings").first())
  expect(ligne?.declaredDomain).toBe("astrotan.illith.com")
})

test("le seed rattrape une ligne déjà seedée sans domaine déclaré", async () => {
  process.env.WEB_SITE_URL = "https://astrotan.illith.com"
  const t = makeTestConvex()
  await t.run(async (ctx) => {
    await ctx.db.insert("settings", { siteName: "AstroTan", homePageSlug: "accueil" })
  })
  await t.mutation(internal.seed.demoContent, {})
  const ligne = await t.run(async (ctx) => ctx.db.query("settings").first())
  expect(ligne?.declaredDomain).toBe("astrotan.illith.com")
})

test("le seed ne remplace pas un domaine déjà saisi", async () => {
  process.env.WEB_DOMAIN = "nouveau.fr"
  const t = makeTestConvex()
  await t.run(async (ctx) => {
    await ctx.db.insert("settings", {
      siteName: "AstroTan",
      homePageSlug: "accueil",
      declaredDomain: "deja-saisi.fr",
    })
  })
  await t.mutation(internal.seed.demoContent, {})
  const ligne = await t.run(async (ctx) => ctx.db.query("settings").first())
  expect(ligne?.declaredDomain).toBe("deja-saisi.fr")
})

test("un repli localhost ne devient pas un domaine déclaré", async () => {
  process.env.WEB_SITE_URL = "http://localhost:4321"
  const t = makeTestConvex()
  await t.mutation(internal.seed.demoContent, {})
  const ligne = await t.run(async (ctx) => ctx.db.query("settings").first())
  expect(ligne?.declaredDomain).toBeUndefined()
})

test("le seed n'allume pas l'agent hors bac à sable", async () => {
  delete process.env.DEMO_SANDBOX
  const t = makeTestConvex()
  await t.mutation(internal.seed.demoContent, {})
  const ligne = await t.run(async (ctx) => ctx.db.query("settings").first())
  expect(ligne?.agentEnabled).not.toBe(true)
})

test("le seed allume l'agent quand DEMO_SANDBOX est actif", async () => {
  process.env.DEMO_SANDBOX = "true"
  const t = makeTestConvex()
  await t.mutation(internal.seed.demoContent, {})
  const ligne = await t.run(async (ctx) => ctx.db.query("settings").first())
  expect(ligne?.agentEnabled).toBe(true)
})

test("le seed rallume l'agent du bac à sable s'il a été éteint", async () => {
  process.env.DEMO_SANDBOX = "true"
  const t = makeTestConvex()
  await t.run(async (ctx) => {
    await ctx.db.insert("settings", {
      siteName: "AstroTan",
      homePageSlug: "accueil",
      agentEnabled: false,
    })
  })
  await t.mutation(internal.seed.demoContent, {})
  const ligne = await t.run(async (ctx) => ctx.db.query("settings").first())
  expect(ligne?.agentEnabled).toBe(true)
})

test("hors bac à sable le seed ne coupe pas un agent déjà allumé", async () => {
  delete process.env.DEMO_SANDBOX
  const t = makeTestConvex()
  await t.run(async (ctx) => {
    await ctx.db.insert("settings", {
      siteName: "AstroTan",
      homePageSlug: "accueil",
      agentEnabled: true,
    })
  })
  await t.mutation(internal.seed.demoContent, {})
  const ligne = await t.run(async (ctx) => ctx.db.query("settings").first())
  expect(ligne?.agentEnabled).toBe(true)
})

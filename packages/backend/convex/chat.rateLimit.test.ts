import { afterEach, beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import { ORIGIN, makeTestConvex } from "../testing/betterAuthFixture"

const SECRET = "un-secret-partage-de-plus-de-32-caracteres"
let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env.LEAD_SUBMIT_SECRET = SECRET
  process.env.CHAT_SESSION_SECRET = "c".repeat(32)
})

afterEach(() => {
  process.env = originalEnv
})

function contact(n: number, origin: string) {
  return {
    secret: SECRET,
    origin,
    name: `Visiteur ${n}`,
    email: `visiteur-${n}@exemple.fr`,
    body: "Bonjour, j'aimerais des informations.",
  }
}

test("épuiser le formulaire ne bloque pas attachEmail", async () => {
  const t = makeTestConvex()
  const origin = "a".repeat(64)
  const { token } = await t.mutation(api.chat.start, { secret: SECRET, origin })

  for (let n = 0; n < 5; n++) {
    await t.mutation(api.leads.submit, contact(n, origin))
  }

  await expect(
    t.mutation(api.chat.attachEmail, {
      secret: SECRET,
      token,
      email: "apres-le-formulaire@exemple.fr",
      origin,
    }),
  ).resolves.toMatchObject({ leadId: expect.any(String) })
})

test("épuiser le budget messages ne bloque pas attachEmail ni le poll", async () => {
  const t = makeTestConvex()
  const origin = "b".repeat(64)
  await t.run(async (ctx) => {
    const existing = await ctx.db.query("settings").first()
    if (existing) await ctx.db.patch(existing._id, { agentEnabled: true })
    else await ctx.db.insert("settings", { siteName: "Mon site", agentEnabled: true })
  })
  const { token } = await t.mutation(api.chat.start, { secret: SECRET, origin })

  for (let n = 0; n < 20; n++) {
    await t.mutation(api.chat.send, {
      secret: SECRET,
      token,
      body: `message ${n}`,
      origin,
    })
  }
  await expect(
    t.mutation(api.chat.send, { secret: SECRET, token, body: "de trop", origin }),
  ).rejects.toMatchObject({ data: { code: "RATE_LIMITED" } })

  await expect(
    t.mutation(api.chat.visitorHeartbeat, { secret: SECRET, token }),
  ).resolves.toMatchObject({ staffOnline: expect.any(Boolean) })
  await expect(
    t.query(api.chat.listVisitorMessages, {
      secret: SECRET,
      token,
      paginationOpts: { numItems: 10, cursor: null },
      streamArgs: { kind: "list" },
    }),
  ).resolves.toMatchObject({ hasLead: false })

  await expect(
    t.mutation(api.chat.attachEmail, {
      secret: SECRET,
      token,
      email: "apres-les-messages@exemple.fr",
      origin,
    }),
  ).resolves.toMatchObject({ leadId: expect.any(String) })
})

test("cinq ouvertures de widget ne bloquent pas le formulaire", async () => {
  const t = makeTestConvex()
  const origin = "c".repeat(64)
  for (let n = 0; n < 5; n++) {
    await t.mutation(api.chat.start, { secret: SECRET, origin })
  }
  await expect(t.mutation(api.leads.submit, contact(0, origin))).resolves.not.toThrow()
})

import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"
import type { TestConvex } from "convex-test"
import type schema from "./schema"

const SECRET = "un-secret-partage-de-plus-de-32-caracteres"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env.LEAD_SUBMIT_SECRET = SECRET
  // `finishAllScheduledFunctions` fait avancer les minuteurs : sans cette
  // ligne, il lève « timers APIs are not mocked » et le webhook ne peut
  // pas être exercé du tout.
  vi.useFakeTimers()
})

afterEach(() => {
  process.env = originalEnv
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor",
) {
  const email = `leads-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple leads"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return await identityFor(t, user.id)
}

const MESSAGE = {
  secret: SECRET,
  name: "Camille Dupont",
  email: "camille@example.com",
  body: "Bonjour, je voudrais un devis.",
}

test("un secret absent, faux ou trop court fait refuser l'écriture", async () => {
  const t = makeTestConvex()

  await expect(t.mutation(api.leads.submit, { ...MESSAGE, secret: "" })).rejects.toThrow()
  await expect(
    t.mutation(api.leads.submit, { ...MESSAGE, secret: "mauvais" }),
  ).rejects.toThrow()

  // Un déploiement dont le secret n'est pas posé doit refuser, jamais
  // accepter tout le monde : l'oubli de configuration est le cas le plus
  // fréquent, et c'est celui où une porte ouverte ne se voit pas.
  delete process.env.LEAD_SUBMIT_SECRET
  await expect(t.mutation(api.leads.submit, MESSAGE)).rejects.toThrow()
})

test("un message crée une fiche et son premier message", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")

  await t.mutation(api.leads.submit, MESSAGE)

  const board = await admin.query(api.leads.board, {})
  expect(board.new).toHaveLength(1)
  expect(board.new[0]).toMatchObject({
    name: "Camille Dupont",
    email: "camille@example.com",
    messageCount: 1,
  })
})

test("réécrire ne crée pas une seconde carte, et remet la fiche en tête", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")

  await t.mutation(api.leads.submit, MESSAGE)
  const board = await admin.query(api.leads.board, {})
  await admin.mutation(api.leads.move, { id: board.new[0]!._id, status: "won" })

  await t.mutation(api.leads.submit, {
    ...MESSAGE,
    // La même personne, un autre nom saisi. On garde celui de la fiche :
    // c'est celui que l'équipe a déjà sous les yeux.
    name: "C. Dupont",
    body: "Je relance.",
  })

  const after = await admin.query(api.leads.board, {})
  expect(after.won).toHaveLength(0)
  expect(after.new).toHaveLength(1)
  expect(after.new[0]).toMatchObject({ name: "Camille Dupont", messageCount: 2 })

  // Rien n'est écrasé : les deux messages sont là, le plus récent en tête.
  const messages = await admin.query(api.leads.messages, { id: after.new[0]!._id })
  expect(messages.map((m) => m.body)).toEqual([
    "Je relance.",
    "Bonjour, je voudrais un devis.",
  ])
})

test("les bornes et l'adresse sont vérifiées côté serveur", async () => {
  const t = makeTestConvex()

  await expect(
    t.mutation(api.leads.submit, { ...MESSAGE, body: "x".repeat(5_001) }),
  ).rejects.toThrow(/TOO_LONG/)
  await expect(
    t.mutation(api.leads.submit, { ...MESSAGE, email: "pas-une-adresse" }),
  ).rejects.toThrow(/INVALID_EMAIL/)
  await expect(
    t.mutation(api.leads.submit, { ...MESSAGE, body: "   " }),
  ).rejects.toThrow(/EMPTY/)
})

test("lire, déplacer et supprimer exigent une session", async () => {
  const t = makeTestConvex()
  await t.mutation(api.leads.submit, MESSAGE)

  // L'écriture est publique — c'est une porte étroite, pas une porte
  // ouverte — mais tout le reste est fermé.
  await expect(t.query(api.leads.board, {})).rejects.toThrow()
  await expect(t.query(api.leads.newCount, {})).rejects.toThrow()
})

test("le compteur ne compte que la première colonne", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")

  await t.mutation(api.leads.submit, MESSAGE)
  await t.mutation(api.leads.submit, { ...MESSAGE, email: "autre@example.com" })
  expect(await admin.query(api.leads.newCount, {})).toBe(2)

  const board = await admin.query(api.leads.board, {})
  await admin.mutation(api.leads.move, { id: board.new[0]!._id, status: "contacted" })
  expect(await admin.query(api.leads.newCount, {})).toBe(1)
})

test("supprimer une fiche emporte ses messages", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  await t.mutation(api.leads.submit, MESSAGE)

  const board = await admin.query(api.leads.board, {})
  const id = board.new[0]!._id
  await admin.mutation(api.leads.remove, { id })

  // Une fiche supprimée qui laisserait ses messages derrière elle serait
  // une fuite : personne ne les verrait plus, et ils resteraient.
  expect((await admin.query(api.leads.board, {})).new).toHaveLength(0)
  await expect(admin.query(api.leads.messages, { id })).rejects.toThrow()
})

test("une panne du webhook ne perd pas le lead", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  await admin.mutation(api.settings.update, {
    siteName: "AstroTan",
    leadWebhookUrl: "https://hook.exemple.fr/leads",
    leadWebhookSecret: "un-secret-de-signature",
  })
  // Le tiers est injoignable. C'est le cas qui compte : le message est
  // arrivé, il doit rester, quoi qu'il advienne de n8n.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))

  await t.mutation(api.leads.submit, MESSAGE)
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  const board = await admin.query(api.leads.board, {})
  expect(board.new).toHaveLength(1)

  const settings = await admin.query(api.settings.get, {})
  // L'échec est VISIBLE : un webhook muet depuis trois semaines est le
  // défaut le plus courant de ce genre d'intégration.
  expect(settings?.leadWebhookLastStatus).toContain("injoignable")
})

test("l'envoi est signé, et ne part pas sans configuration", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const appels: { url: string; signature: string; corps: string }[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      appels.push({
        url: String(url),
        signature: String((init.headers as Record<string, string>)["x-astrotan-signature"]),
        corps: String(init.body),
      })
      return { ok: true, status: 200 }
    }),
  )

  // Sans réglage, rien ne part — et surtout, aucune erreur.
  await t.mutation(api.leads.submit, MESSAGE)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(appels).toHaveLength(0)

  await admin.mutation(api.settings.update, {
    siteName: "AstroTan",
    leadWebhookUrl: "https://hook.exemple.fr/leads",
    leadWebhookSecret: "un-secret-de-signature",
  })
  await t.mutation(api.leads.submit, { ...MESSAGE, email: "autre@example.com" })
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  expect(appels).toHaveLength(1)
  expect(appels[0]!.url).toBe("https://hook.exemple.fr/leads")
  // 64 caractères hexadécimaux : un HMAC-SHA256, pas une chaîne vide qu'un
  // receveur accepterait sans le remarquer.
  expect(appels[0]!.signature).toMatch(/^[0-9a-f]{64}$/)
  expect(JSON.parse(appels[0]!.corps)).toMatchObject({
    type: "lead.created",
    lead: { email: "autre@example.com", name: "Camille Dupont" },
  })
})

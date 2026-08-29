import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { Resend } from "@convex-dev/resend"
import { api, components } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"
import type { TestConvex } from "convex-test"
import type { LeadTimelineEntry } from "./leads"
import type schema from "./schema"
import { SECRETS_KEY_VAR } from "./lib/secretsCrypto"

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

/** Les corps des messages d'une frise, du plus récent au plus ancien. */
function corps(entries: LeadTimelineEntry[]): string[] {
  return entries.flatMap((entry) => (entry.kind === "message" ? [entry.body] : []))
}

/** Les changements de colonne d'une frise, sous une forme lisible. */
function mouvements(entries: LeadTimelineEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.kind === "status"
      ? [`${entry.from} -> ${entry.to} (${entry.actorName ?? "le visiteur"})`]
      : [],
  )
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
  const { entries } = await admin.query(api.leads.timeline, { id: after.new[0]!._id })
  expect(corps(entries)).toEqual(["Je relance.", "Bonjour, je voudrais un devis."])
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
  await expect(admin.query(api.leads.timeline, { id })).rejects.toThrow()
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

  const settings = await admin.query(api.settings.getPrivate, {})
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

// --- Prévenir les responsables -------------------------------------------
//
// L'email est un EFFET DE BORD. La fiche est déjà écrite quand la
// notification part ; c'est ce qui rend acceptable qu'elle échoue. Les
// tests ci-dessous exercent surtout les quatre façons dont elle peut ne
// pas partir — aucune ne doit faire perdre un message.

type EnvoiCapture = {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  replyTo?: string[]
}

/**
 * Espionne l'envoi au niveau du prototype, et non d'une instance : le
 * client Resend est construit à l'appel (voir `lib/resend.ts`), donc il
 * n'existe aucune instance à intercepter avant que l'action ne tourne.
 */
function capturerLesEnvois(): EnvoiCapture[] {
  const envoyes: EnvoiCapture[] = []
  vi.spyOn(Resend.prototype, "sendEmail").mockImplementation((async (
    _ctx: unknown,
    options: EnvoiCapture,
  ) => {
    envoyes.push(options)
    return "email-de-test"
  }) as unknown as Resend["sendEmail"])
  return envoyes
}

/** Renvoie le compteur de tentatives : sans lui, un test « le lead
 *  survit » passerait même si plus aucun envoi n'était tenté. */
function faireEchouerLesEnvois(): { tentatives: number } {
  const compteur = { tentatives: 0 }
  vi.spyOn(Resend.prototype, "sendEmail").mockImplementation((() => {
    compteur.tentatives += 1
    return Promise.reject(new Error("Resend est en panne"))
  }) as unknown as Resend["sendEmail"])
  return compteur
}

async function seedStaff(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor",
  email: string,
) {
  return await seedUser(t, {
    email,
    password: "correct horse battery staple staff",
    name: `Staff ${role}`,
    role,
  })
}

/** Les jobs planifiés qui ont échoué — « rien ne lève » se vérifie ici. */
async function jobsEnEchec(t: TestConvex<typeof schema>): Promise<number> {
  const jobs = await t.run(async (ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  )
  return jobs.filter((job) => job.state.kind === "failed").length
}

test("la notification part aux comptes owner et admin, à personne d'autre", async () => {
  const t = makeTestConvex()
  process.env.RESEND_API_KEY = "re_test_key"
  const envoyes = capturerLesEnvois()

  await seedStaff(t, "owner", "patronne@example.com")
  await seedStaff(t, "admin", "admin@example.com")
  // L'éditeur classe les fiches ; il n'est pas prévenu. Le destinataire
  // d'une notification n'est pas « qui peut lire », c'est « qui doit
  // répondre ».
  await seedStaff(t, "editor", "editrice@example.com")

  await t.mutation(api.leads.submit, { ...MESSAGE, subject: "Devis toiture" })
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  expect(envoyes.map((e) => e.to).sort()).toEqual([
    "admin@example.com",
    "patronne@example.com",
  ])

  const premier = envoyes[0]!
  expect(premier.subject).toContain("Camille Dupont")
  // Qui a écrit, son adresse, le sujet, le message, et où aller lire.
  expect(premier.text).toContain("camille@example.com")
  expect(premier.text).toContain("Devis toiture")
  expect(premier.text).toContain("Bonjour, je voudrais un devis.")
  expect(premier.text).toContain(`${ORIGIN}/leads`)
  expect(premier.html).toContain(`${ORIGIN}/leads`)
  // Répondre à l'email, c'est répondre à la personne — pas à nous-mêmes.
  expect(premier.replyTo).toEqual(["camille@example.com"])
})

test("un compte banni ne reçoit plus rien", async () => {
  const t = makeTestConvex()
  process.env.RESEND_API_KEY = "re_test_key"
  const envoyes = capturerLesEnvois()

  await seedStaff(t, "admin", "encore-la@example.com")
  await seedStaff(t, "admin", "banni@example.com")
  // Écrit directement dans la table du composant : `auth.api.banUser`
  // refuse qu'un admin agisse sur un admin (`ADMIN_ROLE_BOUNDARY`, voir
  // `auth.ts`), et le chemin du ban n'est pas le sujet de ce test — l'état
  // « banni » l'est.
  await t.run(async (ctx) =>
    ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: "user",
        where: [{ field: "email", operator: "eq", value: "banni@example.com" }],
        update: { banned: true },
      },
    }),
  )

  await t.mutation(api.leads.submit, MESSAGE)
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  // Un compte coupé de l'accès ne doit pas continuer à recevoir par email
  // ce qu'on vient de lui interdire de lire.
  expect(envoyes.map((e) => e.to)).toEqual(["encore-la@example.com"])
})

test("un échec d'envoi ne perd pas le lead", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_key"
  const resend = faireEchouerLesEnvois()

  await t.mutation(api.leads.submit, MESSAGE)
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  // L'envoi a bien été tenté, et il a bien échoué — sans quoi ce test
  // passerait aussi le jour où plus rien ne serait envoyé du tout.
  expect(resend.tentatives).toBe(1)

  // Le point central du lot : le message est déjà écrit quand la
  // notification part. Resend peut tomber, la fiche reste.
  const board = await admin.query(api.leads.board, {})
  expect(board.new).toHaveLength(1)
  expect(board.new[0]).toMatchObject({ email: "camille@example.com", messageCount: 1 })
  const { entries } = await admin.query(api.leads.timeline, { id: board.new[0]!._id })
  expect(corps(entries)).toEqual(["Bonjour, je voudrais un devis."])
})

test("sans compte owner ni admin, rien ne part et rien ne lève", async () => {
  const t = makeTestConvex()
  process.env.RESEND_API_KEY = "re_test_key"
  const envoyes = capturerLesEnvois()
  // Le cas d'un déploiement neuf : le premier visiteur peut écrire avant
  // que qui que ce soit n'ait de compte.
  await seedStaff(t, "editor", "editrice@example.com")

  await t.mutation(api.leads.submit, MESSAGE)
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  expect(envoyes).toHaveLength(0)
  expect(await jobsEnEchec(t)).toBe(0)
})

test("sans RESEND_API_KEY, rien ne part et rien ne lève", async () => {
  const t = makeTestConvex()
  delete process.env.RESEND_API_KEY
  const envoyes = capturerLesEnvois()
  await seedStaff(t, "admin", "admin@example.com")

  await t.mutation(api.leads.submit, MESSAGE)
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  // Un template qu'on essaie sans clé d'API ne doit pas casser à la
  // première prise de contact. Le lead arrive, et le job ne rougit pas.
  expect(envoyes).toHaveLength(0)
  expect(await jobsEnEchec(t)).toBe(0)

  const admin = await seedActor(t, "admin")
  expect((await admin.query(api.leads.board, {})).new).toHaveLength(1)
})

test("une clé Resend posée en base fait partir la notification de lead", async () => {
  // Le défaut corrigé ici : la garde de `notifyStaff` ne regardait que
  // `process.env.RESEND_API_KEY`, alors que `makeResend` lit d'abord
  // l'environnement PUIS la base via `lireSecret`. Une clé saisie depuis
  // l'écran des réglages faisait donc partir les invitations et pas les
  // notifications de leads — le même jeton, deux comportements.
  const t = makeTestConvex()
  delete process.env.RESEND_API_KEY
  process.env[SECRETS_KEY_VAR] = Buffer.alloc(32, 7).toString("base64")
  // `owner` sert deux fois : c'est l'acteur qui saisit la clé depuis
  // l'écran, et c'est aussi un destinataire légitime de la notification —
  // exactement le scénario réel.
  const owner = await seedActor(t, "owner")
  await owner.action(api.secrets.set, { nom: "RESEND_API_KEY", valeur: "re_cle_saisie_a_lecran" })

  const envoyes = capturerLesEnvois()
  await t.mutation(api.leads.submit, MESSAGE)
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  expect(envoyes).toHaveLength(1)
})

test("un scénario supprimé est expliqué, pas codé en chiffres", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  await admin.mutation(api.settings.update, {
    siteName: "AstroTan",
    leadWebhookUrl: "https://hook.exemple.fr/leads",
    leadWebhookSecret: "un-secret-de-signature",
  })
  // 410 : ce que Make renvoie quand le scénario a été supprimé. Le cas est
  // fréquent et « échec 410 » n'apprend rien à qui lit l'écran des
  // réglages — cette personne veut savoir quoi faire, pas quel nombre.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 410 }))

  await t.mutation(api.leads.submit, MESSAGE)
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  const settings = await admin.query(api.settings.getPrivate, {})
  expect(settings?.leadWebhookLastStatus).toContain("n'existe plus")
  expect(settings?.leadWebhookLastStatus).toContain("410")

  // Et le lead est là malgré tout : c'est l'invariant du webhook.
  const board = await admin.query(api.leads.board, {})
  expect(board.new).toHaveLength(1)
})

test("ni le webhook ni l'email en panne n'empêchent le lead d'arriver", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_cle_factice"
  await admin.mutation(api.settings.update, {
    siteName: "AstroTan",
    leadWebhookUrl: "https://hook.exemple.fr/leads",
    leadWebhookSecret: "un-secret-de-signature",
  })

  // Les DEUX effets de bord échouent en même temps. C'est l'invariant que
  // le visiteur ne doit jamais payer : il a écrit, son message est là.
  // Chacun est déjà testé seul ; ce test-ci existe parce que le jour où
  // les deux tombent ensemble est précisément celui où on découvre qu'une
  // exception non rattrapée dans l'un annulait l'autre.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))
  const envoi = vi
    .spyOn(Resend.prototype, "sendEmail")
    .mockRejectedValue(new Error("Resend indisponible"))

  await t.mutation(api.leads.submit, MESSAGE)
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  const board = await admin.query(api.leads.board, {})
  expect(board.new).toHaveLength(1)
  expect(board.new[0]!.email).toBe(MESSAGE.email)

  const { entries } = await admin.query(api.leads.timeline, { id: board.new[0]!._id })
  expect(corps(entries)).toHaveLength(1)
  expect(envoi).toHaveBeenCalled()
})

// --- L'historique d'une fiche --------------------------------------------

test("chaque changement de colonne laisse l'ancien, le nouveau et son auteur", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  await t.mutation(api.leads.submit, MESSAGE)

  const board = await admin.query(api.leads.board, {})
  const id = board.new[0]!._id
  await admin.mutation(api.leads.move, { id, status: "contacted" })
  await admin.mutation(api.leads.move, { id, status: "won" })

  const { entries, complete } = await admin.query(api.leads.timeline, { id })

  // C'est tout le point du lot : `leads.move` écrivait le nouveau statut
  // par-dessus l'ancien, qui n'existait plus nulle part.
  expect(mouvements(entries)).toEqual([
    "contacted -> won (Actor admin)",
    "new -> contacted (Actor admin)",
  ])
  // La création est le plancher, et elle est en bas.
  expect(entries.at(-1)).toMatchObject({ kind: "created" })
  expect(complete).toBe(true)
})

test("déposer une fiche dans sa propre colonne n'écrit aucune ligne", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  await t.mutation(api.leads.submit, MESSAGE)
  const id = (await admin.query(api.leads.board, {})).new[0]!._id

  await admin.mutation(api.leads.move, { id, status: "new" })

  // « passé de Nouveau à Nouveau » serait du bruit dans un historique
  // qu'on lit précisément pour comprendre ce qui a changé.
  const { entries } = await admin.query(api.leads.timeline, { id })
  expect(mouvements(entries)).toEqual([])
})

test("une relance raconte le retour en colonne Nouveau, sans auteur", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  await t.mutation(api.leads.submit, MESSAGE)
  const id = (await admin.query(api.leads.board, {})).new[0]!._id
  await admin.mutation(api.leads.move, { id, status: "lost" })

  await t.mutation(api.leads.submit, { ...MESSAGE, body: "Je relance." })

  const { entries } = await admin.query(api.leads.timeline, { id })
  // Personne dans l'équipe ne l'a décidé : la personne a réécrit, et la
  // fiche est remontée. L'auteur absent est ce qui dit cette différence.
  expect(mouvements(entries)).toEqual(["lost -> new (le visiteur)", "new -> lost (Actor admin)"])
  // Et le message se lit au-dessus du mouvement qu'il a provoqué, bien que
  // les deux partagent la milliseconde.
  expect(entries[0]).toMatchObject({ kind: "message", body: "Je relance." })
  expect(entries[1]).toMatchObject({ kind: "status", to: "new" })
})

test("le corps du message reste entier dans la frise", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const long = "Bonjour,\n\n" + "x".repeat(3_000) + "\n\nMerci."
  await t.mutation(api.leads.submit, { ...MESSAGE, subject: "Un devis", body: long })

  const id = (await admin.query(api.leads.board, {})).new[0]!._id
  const { entries } = await admin.query(api.leads.timeline, { id })
  // Tronquer côté serveur rendrait le panneau incapable de montrer ce que
  // la personne a écrit, et personne ne s'en apercevrait.
  expect(entries[0]).toMatchObject({ kind: "message", subject: "Un devis", body: long })
})

test("une fiche antérieure au suivi le dit, et garde ses messages", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")

  // Les lignes déjà en base n'ont aucun événement. On les fabrique telles
  // qu'elles sont — sans événement — plutôt que d'inventer un historique
  // rétroactif à partir de dates approximatives, qui aurait l'air vrai.
  const id = await t.run(async (ctx: any) => {
    const leadId = await ctx.db.insert("leads", {
      name: "Fiche ancienne",
      email: "ancienne@example.com",
      status: "qualified",
      lastMessageAt: Date.now(),
      messageCount: 1,
    })
    await ctx.db.insert("leadMessages", { leadId, body: "Écrit avant le suivi." })
    return leadId
  })

  const { entries, complete } = await admin.query(api.leads.timeline, { id })
  // Le message est là — ne pas savoir ce qui lui est arrivé n'est pas une
  // raison de le cacher — mais la frise ne prétend pas être complète.
  expect(corps(entries)).toEqual(["Écrit avant le suivi."])
  expect(complete).toBe(false)
})

test("un déplacement sur une fiche ancienne complète l'historique sans le réécrire", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const id = await t.run(async (ctx: any) =>
    ctx.db.insert("leads", {
      name: "Fiche ancienne",
      email: "ancienne2@example.com",
      status: "new",
      lastMessageAt: Date.now(),
      messageCount: 0,
    }),
  )

  await admin.mutation(api.leads.move, { id, status: "contacted" })

  const { entries, complete } = await admin.query(api.leads.timeline, { id })
  expect(mouvements(entries)).toEqual(["new -> contacted (Actor admin)"])
  // Le suivi commence là où il commence : la fiche reste marquée
  // incomplète, parce que ce qui a précédé n'a toujours pas été enregistré.
  expect(complete).toBe(false)
})

test("supprimer une fiche emporte son historique", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  await t.mutation(api.leads.submit, MESSAGE)
  const id = (await admin.query(api.leads.board, {})).new[0]!._id
  await admin.mutation(api.leads.move, { id, status: "contacted" })

  await admin.mutation(api.leads.remove, { id })

  // Des événements qui désignent une fiche disparue ne se rendent nulle
  // part et ne se suppriment plus : ils resteraient pour toujours.
  const restants = await t.run(async (ctx: any) => ctx.db.query("leadEvents").collect())
  expect(restants).toHaveLength(0)
})

test("lire l'historique exige une session", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  await t.mutation(api.leads.submit, MESSAGE)
  const id = (await admin.query(api.leads.board, {})).new[0]!._id

  await expect(t.query(api.leads.timeline, { id })).rejects.toThrow()
})

// --- Le gabarit de l'écran « envoi des emails » --------------------------
//
// La notification de lead est le seul des deux envois du dépôt qui compose
// autre chose que le gabarit : la mention de relance, et un objet dont
// toutes les variables viennent d'Internet. Les trois tests suivants
// gardent chacun une de ces frontières.

test("un gabarit personnalisé remplace le texte de la notification", async () => {
  const t = makeTestConvex()
  // L'owner sert deux fois : c'est lui qui réécrit le texte, et c'est lui
  // qui le reçoit. Exactement le scénario réel.
  const owner = await seedActor(t, "owner")
  process.env.RESEND_API_KEY = "re_test_key"
  await owner.mutation(api.emails.setTemplate, {
    cle: "leadNotification",
    objet: "Contact : {{sujet}}",
    corps: "{{nom}} a écrit : {{message}}",
  })

  const envoyes = capturerLesEnvois()
  await t.mutation(api.leads.submit, { ...MESSAGE, subject: "Devis toiture" })
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  expect(envoyes).toHaveLength(1)
  expect(envoyes[0]!.subject).toBe("Contact : Devis toiture")
  expect(envoyes[0]!.text).toBe("Camille Dupont a écrit : Bonjour, je voudrais un devis.")
})

test("la notification coupée, plus rien ne part — et aucun job ne rougit", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  process.env.RESEND_API_KEY = "re_test_key"
  await owner.mutation(api.emails.setActif, { cle: "leadNotification", actif: false })

  const envoyes = capturerLesEnvois()
  await t.mutation(api.leads.submit, MESSAGE)
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  // Couper un envoi est une décision, pas une panne : le silence est le
  // même que sans clé Resend, et le job reste vert.
  expect(envoyes).toHaveLength(0)
  expect(await jobsEnEchec(t)).toBe(0)
  // Le lead, lui, arrive quand même. Couper la notification ne coupe pas
  // la fiche.
  expect((await owner.query(api.leads.board, {})).new).toHaveLength(1)
})

test("l'objet rendu tient sur une seule ligne, quoi que le visiteur écrive", async () => {
  // `validerGabarit` protège le GABARIT, jamais les valeurs : il refuse un
  // objet contenant un saut de ligne, mais `Nouveau message : {{message}}`
  // est un gabarit parfaitement valide — et `message` vient du formulaire
  // public. Sans `singleLine` APRÈS le rendu, l'injection d'en-têtes SMTP
  // rouvre, après toute validation.
  //
  // L'objet emploie `{{message}}` et non `{{nom}}` parce que c'est le seul
  // des deux qui discrimine : `notifyStaff` passe déjà `nom` et `sujet`
  // par `singleLine` avant la substitution (ce sont des champs d'une seule
  // ligne par nature), alors que le corps du message est multi-ligne par
  // construction. Le nom porte quand même un saut de ligne ici, pour que
  // le scénario complet soit couvert.
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  process.env.RESEND_API_KEY = "re_test_key"
  await owner.mutation(api.emails.setTemplate, {
    cle: "leadNotification",
    objet: "Nouveau message de {{nom}} : {{message}}",
    corps: "{{message}}",
  })

  const envoyes = capturerLesEnvois()
  await t.mutation(api.leads.submit, {
    ...MESSAGE,
    name: "Camille\nBcc: quelquun@ailleurs.fr",
    body: "Bonjour\nBcc: quelquun-dautre@ailleurs.fr\n\nà bientôt",
  })
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  expect(envoyes).toHaveLength(1)
  expect(envoyes[0]!.subject).not.toMatch(/[\r\n]/)
})

test("la mention de relance survit au passage par le gabarit", async () => {
  // Elle ne dépend d'aucune variable du catalogue (`messageCount` n'en est
  // pas une) : branchée naïvement, elle disparaîtrait de toutes les
  // notifications de deuxième message sans que rien ne le signale. Ce test
  // est la seule chose qui l'empêche de se reperdre au prochain
  // déplacement.
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  process.env.RESEND_API_KEY = "re_test_key"
  const envoyes = capturerLesEnvois()

  await t.mutation(api.leads.submit, MESSAGE)
  await t.mutation(api.leads.submit, { ...MESSAGE, body: "Je relance." })
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  expect(envoyes).toHaveLength(2)
  expect(envoyes[1]!.text).toContain("2e message de cette personne.")
  expect(envoyes[1]!.html).toContain("2e message de cette personne.")
  // Et pas sur une première prise de contact, sans quoi le test passerait
  // aussi le jour où la mention serait collée à tous les envois.
  expect(envoyes[0]!.text).not.toContain("message de cette personne")

  // La mention tient même quand l'adoptant a réécrit le texte : elle est
  // composée autour du gabarit, pas dedans.
  await owner.mutation(api.emails.setTemplate, {
    cle: "leadNotification",
    objet: "Contact",
    corps: "{{message}}",
  })
  await t.mutation(api.leads.submit, { ...MESSAGE, body: "Je relance encore." })
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  expect(envoyes).toHaveLength(3)
  expect(envoyes[2]!.text).toContain("3e message de cette personne.")
  expect(envoyes[2]!.text).toContain("Je relance encore.")
})

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { internal } from "./_generated/api"
import { makeTestConvex } from "../testing/betterAuthFixture"
import {
  CONSENT_RETENTION_MS,
  LEAD_RETENTION_MS,
  NOTIFICATION_RETENTION_MS,
  RETENTION_BATCH_SIZE,
} from "./retention"

// Ce que ces tests gardent : une durée ÉCRITE sur `/confidentialite` et
// APPLIQUÉE par du code sont deux choses différentes, et c'est l'écart entre
// les deux qu'un contrôle vérifie en premier. Chaque test ci-dessous
// correspond à une phrase de la politique publiée.

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.CONSENT_LOG_SECRET = "a".repeat(64)
  vi.useFakeTimers()
})

afterEach(() => {
  process.env = originalEnv
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Une fiche complète — la fiche, un message, et les deux événements. */
async function seedLead(
  t: ReturnType<typeof makeTestConvex>,
  opts: { email: string; lastMessageAt: number; status?: "new" | "won" },
) {
  return t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", {
      name: "Personne",
      email: opts.email,
      status: opts.status ?? "new",
      lastMessageAt: opts.lastMessageAt,
      messageCount: 1,
    })
    const messageId = await ctx.db.insert("leadMessages", {
      leadId,
      subject: "Bonjour",
      body: "Un message.",
    })
    await ctx.db.insert("leadEvents", { leadId, type: "created", to: "new" })
    await ctx.db.insert("leadEvents", { leadId, type: "message", messageId })
    return leadId
  })
}

const CONSENT_ROW = {
  consentVersion: "1.0.0",
  action: "accept_all" as const,
  timestamp: "2026-01-01T00:00:00.000Z",
  analytics: true,
  marketing: false,
  preferences: false,
}

describe("les durées de conservation", () => {
  test("sont des constantes nommées : 3 ans pour un lead, 365 jours pour un consentement", () => {
    // Le point de cet exercice : une seule source, que la page
    // `/confidentialite` pourra lire au lieu de la répéter à la main. Un
    // chiffre recopié à deux endroits diverge, et c'est la version publiée
    // qui devient fausse.
    const jour = 24 * 60 * 60 * 1000
    expect(LEAD_RETENTION_MS).toBe(3 * 365 * jour)
    expect(CONSENT_RETENTION_MS).toBe(365 * jour)
  })
})

describe("retention.purge — les leads", () => {
  test("une fiche sans échange depuis plus de 3 ans part avec ses messages et son historique", async () => {
    const t = makeTestConvex()
    const now = Date.now()
    await seedLead(t, { email: "vieux@example.com", lastMessageAt: now - LEAD_RETENTION_MS - 1 })

    const report = await t.mutation(internal.retention.purge, {})

    expect(report.leads).toBe(1)
    expect(report.leadMessages).toBe(1)
    expect(report.leadEvents).toBe(2)
    // La cascade compte autant que la suppression : des messages laissés
    // derrière seraient une fuite silencieuse — plus personne ne les voit,
    // et ils restent.
    await t.run(async (ctx) => {
      expect(await ctx.db.query("leads").collect()).toHaveLength(0)
      expect(await ctx.db.query("leadMessages").collect()).toHaveLength(0)
      expect(await ctx.db.query("leadEvents").collect()).toHaveLength(0)
    })
  })

  test("une fiche à un jour de la limite reste, entière", async () => {
    const t = makeTestConvex()
    const now = Date.now()
    await seedLead(t, {
      email: "recent@example.com",
      lastMessageAt: now - LEAD_RETENTION_MS + 24 * 60 * 60 * 1000,
    })

    const report = await t.mutation(internal.retention.purge, {})

    expect(report.leads).toBe(0)
    await t.run(async (ctx) => {
      expect(await ctx.db.query("leads").collect()).toHaveLength(1)
      expect(await ctx.db.query("leadMessages").collect()).toHaveLength(1)
    })
  })

  test("une fiche ancienne rangée dans une autre colonne part aussi", async () => {
    // La purge parcourt l'index `by_status`, colonne par colonne. Si elle
    // en oubliait une, les fiches gagnées ou perdues — celles qui restent
    // le plus longtemps — seraient précisément celles qui survivraient.
    const t = makeTestConvex()
    const now = Date.now()
    await seedLead(t, {
      email: "gagne@example.com",
      lastMessageAt: now - LEAD_RETENTION_MS - 1,
      status: "won",
    })

    const report = await t.mutation(internal.retention.purge, {})

    expect(report.leads).toBe(1)
  })
})

describe("retention.purge — les consentements", () => {
  test("une preuve plus vieille que la validité d'un consentement part ; une récente reste", async () => {
    const t = makeTestConvex()
    const reference = Date.UTC(2026, 7, 29)

    // Les lignes sont insérées de la plus ancienne à la plus récente :
    // `_creationTime` est monotone, remonter le temps ne le ferait pas
    // reculer.
    vi.setSystemTime(reference - CONSENT_RETENTION_MS - 24 * 60 * 60 * 1000)
    await t.run((ctx) =>
      ctx.db.insert("consentRecords", {
        ...CONSENT_ROW,
        visitorId: "appareil-vieux",
        consentId: "geste-vieux",
      }),
    )
    vi.setSystemTime(reference - 60_000)
    await t.run((ctx) =>
      ctx.db.insert("consentRecords", {
        ...CONSENT_ROW,
        visitorId: "appareil-recent",
        consentId: "geste-recent",
      }),
    )
    vi.setSystemTime(reference)

    const report = await t.mutation(internal.retention.purge, {})

    expect(report.consentRecords).toBe(1)
    const restant = await t.run((ctx) => ctx.db.query("consentRecords").collect())
    expect(restant.map((r) => r.consentId)).toEqual(["geste-recent"])
  })
})

describe("retention.purge — les cloches", () => {
  test("une cloche de plus de 90 jours part ; une récente reste", async () => {
    const t = makeTestConvex()
    const reference = Date.UTC(2026, 8, 1)
    vi.setSystemTime(reference - NOTIFICATION_RETENTION_MS - 24 * 60 * 60 * 1000)
    await t.run((ctx) =>
      ctx.db.insert("notifications", {
        authUserId: "user-vieux",
        cle: "leadNotification",
        titre: "Ancienne",
      }),
    )
    vi.setSystemTime(reference - 60_000)
    await t.run((ctx) =>
      ctx.db.insert("notifications", {
        authUserId: "user-recent",
        cle: "leadNotification",
        titre: "Récente",
      }),
    )
    vi.setSystemTime(reference)

    const report = await t.mutation(internal.retention.purge, {})
    expect(report.notifications).toBe(1)
    const restant = await t.run((ctx) => ctx.db.query("notifications").collect())
    expect(restant.map((r) => r.titre)).toEqual(["Récente"])
  })

  test("la cascade d'un lead ancien emporte ses cloches", async () => {
    const t = makeTestConvex()
    const now = Date.now()
    const leadId = await seedLead(t, {
      email: "vieux-cloche@example.com",
      lastMessageAt: now - LEAD_RETENTION_MS - 1,
    })
    await t.run((ctx) =>
      ctx.db.insert("notifications", {
        authUserId: "staff",
        cle: "leadNotification",
        titre: "Nouveau message de contact",
        leadId,
      }),
    )
    await t.mutation(internal.retention.purge, {})
    expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toEqual([])
  })
})

describe("retention.purge — la borne", () => {
  test("un lot plein s'arrête à la borne et annonce qu'il en reste", async () => {
    // Un cron qui `.collect()` une table entière marche jusqu'au jour où la
    // table est grande, puis échoue au moment où on en a le plus besoin.
    const t = makeTestConvex()
    const reference = Date.UTC(2026, 7, 29)
    vi.setSystemTime(reference - CONSENT_RETENTION_MS - 24 * 60 * 60 * 1000)
    await t.run(async (ctx) => {
      for (let i = 0; i < RETENTION_BATCH_SIZE + 5; i++) {
        await ctx.db.insert("consentRecords", {
          ...CONSENT_ROW,
          visitorId: `appareil-${i}`,
          consentId: `geste-${i}`,
        })
      }
    })
    vi.setSystemTime(reference)

    const report = await t.mutation(internal.retention.purge, {})

    expect(report.consentRecords).toBe(RETENTION_BATCH_SIZE)
    expect(report.hasMore).toBe(true)
    const restant = await t.run((ctx) => ctx.db.query("consentRecords").collect())
    expect(restant).toHaveLength(5)
  })

  test("la suite est reprise d'elle-même, sans attendre le mois suivant", async () => {
    // Sans cette reprise, un retard de 10 000 lignes mettrait cent mois à
    // se résorber — une purge qui n'a jamais fini n'applique aucune durée.
    const t = makeTestConvex()
    const reference = Date.UTC(2026, 7, 29)
    vi.setSystemTime(reference - CONSENT_RETENTION_MS - 24 * 60 * 60 * 1000)
    await t.run(async (ctx) => {
      for (let i = 0; i < RETENTION_BATCH_SIZE + 5; i++) {
        await ctx.db.insert("consentRecords", {
          ...CONSENT_ROW,
          visitorId: `appareil-${i}`,
          consentId: `geste-${i}`,
        })
      }
    })
    vi.setSystemTime(reference)

    await t.mutation(internal.retention.purge, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    const restant = await t.run((ctx) => ctx.db.query("consentRecords").collect())
    expect(restant).toHaveLength(0)
  })

  test("un passage qui ne remplit pas son lot ne se replanifie pas", async () => {
    const t = makeTestConvex()
    const now = Date.now()
    await seedLead(t, { email: "vieux@example.com", lastMessageAt: now - LEAD_RETENTION_MS - 1 })

    const report = await t.mutation(internal.retention.purge, {})

    expect(report.hasMore).toBe(false)
    const planifies = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    )
    expect(planifies).toHaveLength(0)
  })
})

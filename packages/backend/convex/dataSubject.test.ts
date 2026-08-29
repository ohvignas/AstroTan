import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { internal } from "./_generated/api"
import { makeTestConvex } from "../testing/betterAuthFixture"

// Le droit d'accès et le droit à la portabilité (RGPD, articles 15 et 20)
// sont annoncés sur `/confidentialite`. Avant ces fonctions, le dépôt ne
// savait que SUPPRIMER — répondre à une demande d'accès se serait fait à la
// main, dans le tableau de bord Convex, en espérant n'oublier aucune table.

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.CONSENT_LOG_SECRET = "a".repeat(64)
})

afterEach(() => {
  process.env = originalEnv
  vi.restoreAllMocks()
})

async function seedLead(t: ReturnType<typeof makeTestConvex>, email: string) {
  return t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", {
      name: "Camille",
      email,
      status: "contacted",
      lastMessageAt: Date.now(),
      messageCount: 2,
    })
    const messageId = await ctx.db.insert("leadMessages", {
      leadId,
      subject: "Devis",
      body: "Bonjour, je cherche un devis.",
      userAgent: "Mozilla/5.0",
    })
    await ctx.db.insert("leadEvents", { leadId, type: "created", to: "new" })
    await ctx.db.insert("leadEvents", { leadId, type: "message", messageId })
    await ctx.db.insert("leadEvents", {
      leadId,
      type: "status",
      from: "new",
      to: "contacted",
      actorId: "admin-1",
      actorName: "Antoine",
    })
    return leadId
  })
}

describe("dataSubject.exportByEmail", () => {
  test("rassemble la fiche, ses messages et son historique", async () => {
    const t = makeTestConvex()
    await seedLead(t, "camille@example.com")

    const dossier = await t.query(internal.dataSubject.exportByEmail, {
      email: "camille@example.com",
    })

    expect(dossier.leads).toHaveLength(1)
    expect(dossier.leads[0]!.lead.name).toBe("Camille")
    expect(dossier.leads[0]!.messages.map((m) => m.body)).toEqual([
      "Bonjour, je cherche un devis.",
    ])
    expect(dossier.leads[0]!.events).toHaveLength(3)
  })

  test("normalise l'adresse comme le formulaire l'a normalisée à l'écriture", async () => {
    // `leads.submit` écrit `email.trim().toLowerCase()`. Une recherche qui
    // ne ferait pas le même geste répondrait « rien » à une personne dont
    // les données existent — le pire résultat possible pour une demande
    // d'accès, parce qu'il a l'air d'une réponse.
    const t = makeTestConvex()
    await seedLead(t, "camille@example.com")

    const dossier = await t.query(internal.dataSubject.exportByEmail, {
      email: "  Camille@Example.COM  ",
    })

    expect(dossier.leads).toHaveLength(1)
  })

  test("une adresse inconnue rend un dossier vide, jamais une erreur", async () => {
    // « Nous ne détenons rien à votre sujet » est une réponse valable à une
    // demande d'accès, et c'est celle-là qu'il faut pouvoir produire.
    const t = makeTestConvex()

    const dossier = await t.query(internal.dataSubject.exportByEmail, {
      email: "inconnu@example.com",
    })

    expect(dossier.leads).toEqual([])
    expect(dossier.invitations).toEqual([])
  })

  test("une invitation adressée à cette personne figure au dossier, sans son jeton", async () => {
    const t = makeTestConvex()
    await t.run((ctx) =>
      ctx.db.insert("invitations", {
        email: "camille@example.com",
        role: "editor",
        tokenHash: "secret-hash",
        pendingToken: "secret-clair",
        expiresAt: Date.now() + 1000,
        invitedBy: "admin-1",
      }),
    )

    const dossier = await t.query(internal.dataSubject.exportByEmail, {
      email: "camille@example.com",
    })

    expect(dossier.invitations).toHaveLength(1)
    expect(dossier.invitations[0]!.role).toBe("editor")
    // Le jeton n'est pas la donnée de cette personne, c'est un secret
    // d'authentification. L'exporter transformerait une demande d'accès en
    // moyen de se faire remettre une clé.
    expect(dossier.invitations[0]).not.toHaveProperty("tokenHash")
    expect(dossier.invitations[0]).not.toHaveProperty("pendingToken")
  })

  test("aucun consentement n'est rattaché à l'adresse, et le dossier le dit", async () => {
    // Le point honnête de cet export. Un `consentRecord` porte un
    // `visitorId` d'appareil, tiré au hasard, qui n'a jamais croisé une
    // adresse. Inventer une jointure produirait le consentement de
    // QUELQU'UN D'AUTRE — une violation en réponse à une demande d'accès.
    const t = makeTestConvex()
    await seedLead(t, "camille@example.com")
    await t.run((ctx) =>
      ctx.db.insert("consentRecords", {
        consentVersion: "1.0.0",
        visitorId: "appareil-inconnu",
        consentId: "geste-1",
        action: "accept_all",
        timestamp: "2026-01-01T00:00:00.000Z",
        analytics: true,
        marketing: false,
        preferences: false,
      }),
    )

    const dossier = await t.query(internal.dataSubject.exportByEmail, {
      email: "camille@example.com",
    })

    expect(dossier).not.toHaveProperty("consentRecords")
    expect(dossier.notes.join(" ")).toMatch(/visitorId/)
  })
})

describe("dataSubject.exportByVisitor", () => {
  test("rend les consentements d'un appareil, du plus récent au plus ancien", async () => {
    const t = makeTestConvex()
    await t.run(async (ctx) => {
      for (const [i, action] of (["accept_all", "update"] as const).entries()) {
        await ctx.db.insert("consentRecords", {
          consentVersion: "1.0.0",
          visitorId: "appareil-1",
          consentId: `geste-${i}`,
          action,
          timestamp: "2026-01-01T00:00:00.000Z",
          analytics: action === "accept_all",
          marketing: false,
          preferences: false,
        })
      }
      await ctx.db.insert("consentRecords", {
        consentVersion: "1.0.0",
        visitorId: "appareil-2",
        consentId: "geste-autre",
        action: "reject_all",
        timestamp: "2026-01-01T00:00:00.000Z",
        analytics: false,
        marketing: false,
        preferences: false,
      })
    })

    const dossier = await t.query(internal.dataSubject.exportByVisitor, {
      visitorId: "appareil-1",
    })

    expect(dossier.consentRecords.map((r) => r.consentId)).toEqual([
      "geste-1",
      "geste-0",
    ])
  })

  test("un appareil inconnu rend un dossier vide", async () => {
    const t = makeTestConvex()
    const dossier = await t.query(internal.dataSubject.exportByVisitor, {
      visitorId: "jamais-vu",
    })
    expect(dossier.consentRecords).toEqual([])
  })
})

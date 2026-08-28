import { v } from "convex/values"
import { ConvexError } from "convex/values"
import { mutation, query } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import { api } from "./_generated/api"
import { MUTATION_REGISTRY } from "./_registry"
import { requireRole } from "./lib/authz"
import { timingSafeEqualHex } from "./lib/previewToken"
import {
  LEAD_STATUSES,
  MAX_LEAD_BODY_LENGTH,
  MAX_LEAD_EMAIL_LENGTH,
  MAX_LEAD_NAME_LENGTH,
  MAX_LEAD_SUBJECT_LENGTH,
  looksLikeEmail,
  type LeadStatus,
} from "./content"

// Les personnes qui écrivent depuis le formulaire de contact.
//
// `submit` est la SEULE écriture publique de tout le backend. Partout
// ailleurs, `apps/web` ne fait que lire. Cette exception est étroite par
// construction : elle exige un secret partagé que seul le serveur détient,
// et elle est appelée par une route Astro qui voit l'IP et limite le débit
// — deux choses qu'un navigateur ne peut pas fournir honnêtement.

const statusValidator = v.union(...LEAD_STATUSES.map((s) => v.literal(s)))

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Le secret partagé, comparé à temps constant.
 *
 * Les deux côtés sont hachés avant comparaison : le condensé fait toujours
 * 64 caractères, donc la comparaison ne peut pas révéler la longueur du
 * secret attendu par le temps qu'elle met — ni lever sur des longueurs
 * différentes. C'est le même raisonnement que `/api/revalidate`, avec les
 * outils disponibles ici (pas de `node:crypto` dans ce runtime).
 */
async function assertSecret(provided: string): Promise<void> {
  const expected = process.env.LEAD_SUBMIT_SECRET
  // Un déploiement sans secret refuse tout le monde. L'inverse — accepter
  // quand rien n'est configuré — transformerait un oubli de configuration
  // en porte ouverte, et personne ne le verrait.
  if (!expected) throw new ConvexError({ code: "NOT_CONFIGURED" })
  const [a, b] = await Promise.all([sha256Hex(provided), sha256Hex(expected)])
  if (!timingSafeEqualHex(a, b)) throw new ConvexError({ code: "FORBIDDEN" })
}

function assertBounded(value: string, max: number, field: string): void {
  if (value.length > max) throw new ConvexError({ code: "TOO_LONG", field })
}

export const submit = mutation({
  args: {
    secret: v.string(),
    name: v.string(),
    email: v.string(),
    subject: v.optional(v.string()),
    body: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    await assertSecret(args.secret)

    const name = args.name.trim()
    const email = args.email.trim().toLowerCase()
    const body = args.body.trim()
    const subject = args.subject?.trim() || undefined

    // Vide après nettoyage : un formulaire rempli d'espaces n'est pas un
    // message, et le laisser passer remplirait le tableau de cartes vides.
    if (name.length === 0 || body.length === 0) {
      throw new ConvexError({ code: "EMPTY" })
    }
    assertBounded(name, MAX_LEAD_NAME_LENGTH, "name")
    assertBounded(email, MAX_LEAD_EMAIL_LENGTH, "email")
    assertBounded(body, MAX_LEAD_BODY_LENGTH, "body")
    if (subject) assertBounded(subject, MAX_LEAD_SUBJECT_LENGTH, "subject")
    if (!looksLikeEmail(email)) throw new ConvexError({ code: "INVALID_EMAIL" })

    const now = Date.now()
    // L'email fait l'identité : quelqu'un qui réécrit ne crée pas une
    // seconde carte à côté de la sienne.
    const existing = await ctx.db
      .query("leads")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique()

    let leadId: Id<"leads">
    if (existing === null) {
      leadId = await ctx.db.insert("leads", {
        name,
        email,
        status: "new",
        lastMessageAt: now,
        messageCount: 1,
      })
    } else {
      leadId = existing._id
      await ctx.db.patch(leadId, {
        // Le nom de la fiche est conservé : c'est celui que l'équipe a déjà
        // sous les yeux, et un formulaire re-rempli à la va-vite ne doit pas
        // renommer un contact connu.
        status: "new",
        lastMessageAt: now,
        messageCount: existing.messageCount + 1,
      })
    }

    // Un message n'écrase jamais le précédent. Fusionner les deux forcerait
    // à choisir entre garder le premier ou le dernier, et les deux choix
    // perdent quelque chose que personne ne pourra retrouver.
    await ctx.db.insert("leadMessages", {
      leadId,
      subject,
      body,
      userAgent: args.userAgent,
    })

    return null
  },
})

export type Board = Record<LeadStatus, Doc<"leads">[]>

export const board = query({
  args: {},
  handler: async (ctx): Promise<Board> => {
    await requireRole(ctx, ["owner", "admin", "editor"])

    const columns = await Promise.all(
      LEAD_STATUSES.map((status) =>
        ctx.db
          .query("leads")
          .withIndex("by_status", (q) => q.eq("status", status))
          // Le plus récent en tête : c'est l'ordre dans lequel on répond.
          .order("desc")
          .collect(),
      ),
    )

    return Object.fromEntries(
      LEAD_STATUSES.map((status, index) => [status, columns[index]]),
    ) as Board
  },
})

export const messages = query({
  args: { id: v.id("leads") },
  handler: async (ctx, args): Promise<Doc<"leadMessages">[]> => {
    await requireRole(ctx, ["owner", "admin", "editor"])

    // La fiche d'abord : sans elle, rendre une liste vide laisserait croire
    // qu'une personne connue n'a jamais rien écrit.
    const lead = await ctx.db.get(args.id)
    if (lead === null) throw new ConvexError({ code: "NOT_FOUND" })

    return await ctx.db
      .query("leadMessages")
      .withIndex("by_lead", (q) => q.eq("leadId", args.id))
      .order("desc")
      .collect()
  },
})

export const newCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const waiting = await ctx.db
      .query("leads")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect()
    return waiting.length
  },
})

export const move = mutation({
  args: { id: v.id("leads"), status: statusValidator },
  handler: async (ctx, args): Promise<null> => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const lead = await ctx.db.get(args.id)
    if (lead === null) throw new ConvexError({ code: "NOT_FOUND" })
    await ctx.db.patch(args.id, { status: args.status })
    return null
  },
})

export const remove = mutation({
  args: { id: v.id("leads") },
  handler: async (ctx, args): Promise<null> => {
    // Supprimer est réservé : un éditeur classe, il n'efface pas ce qu'un
    // visiteur a écrit.
    await requireRole(ctx, ["owner", "admin"])
    const lead = await ctx.db.get(args.id)
    if (lead === null) throw new ConvexError({ code: "NOT_FOUND" })

    // Les messages partent avec la fiche. Les laisser derrière serait une
    // fuite silencieuse : plus personne ne les verrait, et ils resteraient.
    const messages = await ctx.db
      .query("leadMessages")
      .withIndex("by_lead", (q) => q.eq("leadId", args.id))
      .collect()
    for (const message of messages) await ctx.db.delete(message._id)

    await ctx.db.delete(args.id)
    return null
  },
})

// --- Registre des mutations ----------------------------------------------
//
// `submit` n'est gardée par aucun rôle, volontairement : c'est ainsi qu'un
// visiteur sans compte écrit. Son autorisation est la possession du secret
// partagé, jamais le rôle de l'appelant. Déclarer les trois rôles l'enregistre
// honnêtement — aucun n'est refusé, parce qu'aucun n'est ce que `submit`
// vérifie. Le vrai cas, l'appel sans session, est couvert par `leads.test.ts`,
// que cette matrice n'exerce jamais.
MUTATION_REGISTRY.push(
  {
    name: "leads.submit",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: (t) =>
      t.mutation(api.leads.submit, {
        secret: process.env.LEAD_SUBMIT_SECRET ?? "",
        name: "Registre",
        email: `registry-${Date.now()}-${Math.random()}@example.com`,
        body: "Message du registre.",
      }),
  },
  {
    name: "leads.move",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const id = await t.run((ctx: any) =>
        ctx.db.insert("leads", {
          name: "Registre",
          email: `registry-move-${Date.now()}-${Math.random()}@example.com`,
          status: "new",
          lastMessageAt: Date.now(),
          messageCount: 1,
        }),
      )
      return t.mutation(api.leads.move, { id, status: "contacted" })
    },
  },
  {
    // Supprimer est réservé : un éditeur classe, il n'efface pas ce qu'un
    // visiteur a écrit.
    name: "leads.remove",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const id = await t.run((ctx: any) =>
        ctx.db.insert("leads", {
          name: "Registre",
          email: `registry-remove-${Date.now()}-${Math.random()}@example.com`,
          status: "new",
          lastMessageAt: Date.now(),
          messageCount: 1,
        }),
      )
      return t.mutation(api.leads.remove, { id })
    },
  },
)

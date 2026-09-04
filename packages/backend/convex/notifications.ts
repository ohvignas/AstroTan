import { ConvexError, v } from "convex/values"
import { internalAction, internalQuery, mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { api, internal } from "./_generated/api"
import { MUTATION_REGISTRY } from "./_registry"
import { isCurrentlyBanned, requireRole } from "./lib/authz"
import { composerMessage, identiteAvecLogoJoignable } from "./lib/emailLayout"
import { deriverOrigines } from "./lib/origines"
import { resolvePostAuthors } from "./lib/postAuthor"
import { makeResend } from "./lib/resend"
import {
  canalParDefaut,
  destinatairesPourCanal,
  type CleNotification,
  type Destinataire,
  type RoleNotif,
} from "./lib/notifier"
import { resoudreExpediteur } from "./lib/expediteur"
import { lireSecret } from "./secrets"
import { listUsersWithRole } from "./users"

const CLES = ["leadNotification", "postPublished"] as const
const TITRES: Record<CleNotification, string> = {
  leadNotification: "Nouveau message de contact",
  postPublished: "Un collègue a publié un article",
}
const cleValidator = v.union(v.literal("leadNotification"), v.literal("postPublished"))
const ROLES: RoleNotif[] = ["owner", "admin", "editor"]

export async function listerCandidats(
  ctx: QueryCtx | MutationCtx,
): Promise<Destinataire[]> {
  const lots = await Promise.all(ROLES.map((role) => listUsersWithRole(ctx, role)))
  const seen = new Set<string>()
  const out: Destinataire[] = []
  for (let i = 0; i < ROLES.length; i++) {
    const role = ROLES[i]!
    for (const user of lots[i]!) {
      if (seen.has(user.id) || isCurrentlyBanned(user)) continue
      seen.add(user.id)
      out.push({ authUserId: user.id, email: user.email, role })
    }
  }
  return out
}

export const mesPrefs = query({
  args: {},
  handler: async (ctx) => {
    const acteur = await requireRole(ctx, ["owner", "admin", "editor"])
    const lignes = []
    for (const cle of CLES) {
      const row = await ctx.db
        .query("notificationPrefs")
        .withIndex("by_user_cle", (q) => q.eq("authUserId", acteur._id).eq("cle", cle))
        .unique()
      lignes.push({
        cle,
        titre: TITRES[cle],
        cloche: row?.cloche ?? canalParDefaut(cle, "cloche", acteur.role),
        email: row?.email ?? canalParDefaut(cle, "email", acteur.role),
      })
    }
    return lignes
  },
})

export const setPrefs = mutation({
  args: { cle: cleValidator, cloche: v.boolean(), email: v.boolean() },
  handler: async (ctx, args) => {
    const acteur = await requireRole(ctx, ["owner", "admin", "editor"])
    const existing = await ctx.db
      .query("notificationPrefs")
      .withIndex("by_user_cle", (q) =>
        q.eq("authUserId", acteur._id).eq("cle", args.cle),
      )
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        cloche: args.cloche,
        email: args.email,
        majAt: Date.now(),
      })
    } else {
      await ctx.db.insert("notificationPrefs", {
        authUserId: acteur._id,
        cle: args.cle,
        cloche: args.cloche,
        email: args.email,
        majAt: Date.now(),
      })
    }
    return null
  },
})

export const liste = query({
  args: {},
  handler: async (ctx) => {
    const acteur = await requireRole(ctx, ["owner", "admin", "editor"])
    const toutes = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("authUserId", acteur._id))
      .order("desc")
      .collect()
    const nonLues = toutes.filter((n) => n.readAt === undefined)
    return {
      lignes: nonLues.slice(0, 30),
      nonLues: nonLues.length,
    }
  },
})

export const marquerLu = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, args) => {
    const acteur = await requireRole(ctx, ["owner", "admin", "editor"])
    const row = await ctx.db.get(args.id)
    if (!row || row.authUserId !== acteur._id) {
      throw new ConvexError({ code: "NOT_FOUND" })
    }
    if (row.readAt === undefined) await ctx.db.patch(args.id, { readAt: Date.now() })
    return null
  },
})

export const marquerToutesLues = mutation({
  args: {},
  handler: async (ctx) => {
    const acteur = await requireRole(ctx, ["owner", "admin", "editor"])
    const toutes = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("authUserId", acteur._id))
      .collect()
    const now = Date.now()
    for (const row of toutes) {
      if (row.readAt === undefined) await ctx.db.patch(row._id, { readAt: now })
    }
    return null
  },
})

export const destinatairesPourEmail = internalQuery({
  args: { cle: cleValidator, exclus: v.array(v.string()) },
  handler: async (ctx, args) => {
    const candidats = await listerCandidats(ctx)
    return destinatairesPourCanal(ctx, candidats, args.cle, "email", args.exclus)
  },
})

export const auteurDePost = internalQuery({
  args: { auteurId: v.string() },
  handler: async (ctx, args) => {
    const authors = await resolvePostAuthors(ctx, [args.auteurId])
    return authors.get(args.auteurId)?.displayName ?? "—"
  },
})

export const notifyPublished = internalAction({
  args: {
    postId: v.id("posts"),
    titre: v.string(),
    auteurId: v.string(),
    exclus: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const gabarit = await ctx.runQuery(internal.emails.gabarit, { cle: "postPublished" })
    if (!gabarit.actif) return null
    const cleResend = await lireSecret(ctx, "RESEND_API_KEY")
    if (!cleResend) return null
    const recipients = await ctx.runQuery(internal.notifications.destinatairesPourEmail, {
      cle: "postPublished",
      exclus: args.exclus,
    })
    if (recipients.length === 0) return null
    const { admin: siteUrl } = deriverOrigines(
      await ctx.runQuery(internal.settings.domaineDeclare, {}),
    )
    if (!siteUrl) throw new Error("SITE_URL is not set on this Convex deployment")
    const identite = await identiteAvecLogoJoignable(
      await ctx.runQuery(internal.settings.identiteEmail, {}),
    )
    const auteur = await ctx.runQuery(internal.notifications.auteurDePost, {
      auteurId: args.auteurId,
    })
    const valeurs = {
      nom_du_site: identite.siteName,
      url: `${siteUrl}/posts/${args.postId}`,
      titre: args.titre,
      auteur,
    }
    const resend = await makeResend(ctx)
    const expediteur = await resoudreExpediteur(ctx)
    const message = composerMessage(gabarit, valeurs, "postPublished", identite)
    for (const dest of recipients) {
      await resend.sendEmail(ctx, {
        from: expediteur,
        to: dest.email,
        ...message,
      })
    }
    return null
  },
})

MUTATION_REGISTRY.push(
  {
    name: "notifications.setPrefs",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: (t) =>
      t.mutation(api.notifications.setPrefs, {
        cle: "leadNotification",
        cloche: true,
        email: false,
      }),
  },
  {
    name: "notifications.marquerLu",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const me = await t.query(api.profiles.me, {})
      const id = await t.run((ctx: any) =>
        ctx.db.insert("notifications", {
          authUserId: me.authUserId,
          cle: "leadNotification",
          titre: "Nouveau message de contact",
        }),
      )
      return t.mutation(api.notifications.marquerLu, { id })
    },
  },
  {
    name: "notifications.marquerToutesLues",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const me = await t.query(api.profiles.me, {})
      await t.run((ctx: any) =>
        ctx.db.insert("notifications", {
          authUserId: me.authUserId,
          cle: "leadNotification",
          titre: "Nouveau message de contact",
        }),
      )
      return t.mutation(api.notifications.marquerToutesLues, {})
    },
  },
)

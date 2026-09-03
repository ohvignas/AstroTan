import type { Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

export type CleNotification = "leadNotification" | "postPublished"
export type Canal = "cloche" | "email"
export type RoleNotif = "owner" | "admin" | "editor"

export type Destinataire = {
  authUserId: string
  email: string
  role: RoleNotif
}

export type PrefLigne = { cloche: boolean; email: boolean }

export function canalParDefaut(
  cle: CleNotification,
  canal: Canal,
  role: RoleNotif,
): boolean {
  if (canal === "cloche") return true
  if (cle === "leadNotification") return role === "owner" || role === "admin"
  return false
}

export function canalOuvert(
  ligne: PrefLigne | null,
  cle: CleNotification,
  canal: Canal,
  role: RoleNotif,
): boolean {
  if (ligne) return ligne[canal]
  return canalParDefaut(cle, canal, role)
}

async function prefPour(
  ctx: QueryCtx | MutationCtx,
  authUserId: string,
  cle: CleNotification,
): Promise<PrefLigne | null> {
  const ligne = await ctx.db
    .query("notificationPrefs")
    .withIndex("by_user_cle", (q) => q.eq("authUserId", authUserId).eq("cle", cle))
    .unique()
  return ligne ? { cloche: ligne.cloche, email: ligne.email } : null
}

export async function destinatairesPourCanal(
  ctx: QueryCtx | MutationCtx,
  candidats: readonly Destinataire[],
  cle: CleNotification,
  canal: Canal,
  exclus: readonly string[],
): Promise<Destinataire[]> {
  const exclusSet = new Set(exclus)
  const retenus: Destinataire[] = []
  for (const candidat of candidats) {
    if (exclusSet.has(candidat.authUserId)) continue
    const pref = await prefPour(ctx, candidat.authUserId, cle)
    if (canalOuvert(pref, cle, canal, candidat.role)) retenus.push(candidat)
  }
  return retenus
}

export async function ecrireCloches(
  ctx: MutationCtx,
  args: {
    cle: CleNotification
    titre: string
    leadId?: Id<"leads">
    postId?: Id<"posts">
    exclus: readonly string[]
    candidats: readonly Destinataire[]
  },
): Promise<number> {
  const destinataires = await destinatairesPourCanal(
    ctx,
    args.candidats,
    args.cle,
    "cloche",
    args.exclus,
  )
  for (const dest of destinataires) {
    await ctx.db.insert("notifications", {
      authUserId: dest.authUserId,
      cle: args.cle,
      titre: args.titre,
      ...(args.leadId ? { leadId: args.leadId } : {}),
      ...(args.postId ? { postId: args.postId } : {}),
    })
  }
  return destinataires.length
}

export async function marquerLuesPourLead(
  ctx: MutationCtx,
  leadId: Id<"leads">,
): Promise<number> {
  const rows = await ctx.db
    .query("notifications")
    .withIndex("by_lead", (q) => q.eq("leadId", leadId))
    .collect()
  const now = Date.now()
  let n = 0
  for (const row of rows) {
    if (row.readAt === undefined) {
      await ctx.db.patch(row._id, { readAt: now })
      n++
    }
  }
  return n
}

export async function supprimerPourLead(
  ctx: MutationCtx,
  leadId: Id<"leads">,
): Promise<number> {
  const rows = await ctx.db
    .query("notifications")
    .withIndex("by_lead", (q) => q.eq("leadId", leadId))
    .collect()
  for (const row of rows) await ctx.db.delete(row._id)
  return rows.length
}

export async function supprimerPourPost(
  ctx: MutationCtx,
  postId: Id<"posts">,
): Promise<number> {
  const rows = await ctx.db
    .query("notifications")
    .withIndex("by_post", (q) => q.eq("postId", postId))
    .collect()
  for (const row of rows) await ctx.db.delete(row._id)
  return rows.length
}

export async function supprimerPourCompte(
  ctx: MutationCtx,
  authUserId: string,
): Promise<void> {
  const prefs = await ctx.db
    .query("notificationPrefs")
    .withIndex("by_user", (q) => q.eq("authUserId", authUserId))
    .collect()
  for (const row of prefs) await ctx.db.delete(row._id)
  const cloches = await ctx.db
    .query("notifications")
    .withIndex("by_user", (q) => q.eq("authUserId", authUserId))
    .collect()
  for (const row of cloches) await ctx.db.delete(row._id)
}

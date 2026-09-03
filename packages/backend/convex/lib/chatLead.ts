import { ConvexError } from "convex/values"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { MAX_LEAD_EMAIL_LENGTH, MAX_LEAD_NAME_LENGTH, looksLikeEmail } from "../content"
import { leadGeoPatch, type LeadGeo } from "./leadGeo"
import { ecrireCloches, supprimerPourLead } from "./notifier"
import { listerCandidats } from "../notifications"

export const ANON_LEAD_NAME = "Visiteur"

function assertBounded(value: string, max: number, field: string): void {
  if (value.length > max) throw new ConvexError({ code: "TOO_LONG", field })
}

export function normalizeChatEmail(raw: string | undefined): string {
  return raw?.trim().toLowerCase() ?? ""
}

export function assertChatEmail(email: string): void {
  assertBounded(email, MAX_LEAD_EMAIL_LENGTH, "email")
  if (!looksLikeEmail(email)) throw new ConvexError({ code: "INVALID_EMAIL" })
}

export function displayNameFromEmail(email: string, name?: string): string {
  const trimmed = name?.trim() ?? ""
  const resolved = trimmed.length > 0 ? trimmed : email.slice(0, email.indexOf("@"))
  assertBounded(resolved, MAX_LEAD_NAME_LENGTH, "name")
  return resolved
}

function displayNameForInsert(email: string | undefined, name?: string): string {
  if (email && email.length > 0) return displayNameFromEmail(email, name)
  const trimmed = name?.trim() ?? ""
  const resolved = trimmed.length > 0 ? trimmed : ANON_LEAD_NAME
  assertBounded(resolved, MAX_LEAD_NAME_LENGTH, "name")
  return resolved
}

/**
 * Une fiche anonyme (IP, pas d'e-mail) est absorbée dans la fiche e-mail
 * déjà connue. On re-pointe sessions / messages / événements ; on ne
 * touche pas au thread — la cascade le détruirait.
 */
async function absorbAnonymousLead(
  ctx: MutationCtx,
  keeperId: Id<"leads">,
  orphanId: Id<"leads">,
): Promise<void> {
  if (keeperId === orphanId) return
  const orphan = await ctx.db.get(orphanId)
  if (orphan === null || orphan.email) return

  const keeper = await ctx.db.get(keeperId)
  if (keeper && !keeper.threadId && orphan.threadId) {
    await ctx.db.patch(keeperId, { threadId: orphan.threadId })
  }

  const sessions = await ctx.db
    .query("chatSessions")
    .withIndex("by_lead", (q) => q.eq("leadId", orphanId))
    .collect()
  for (const session of sessions) await ctx.db.patch(session._id, { leadId: keeperId })

  const events = await ctx.db
    .query("leadEvents")
    .withIndex("by_lead", (q) => q.eq("leadId", orphanId))
    .collect()
  for (const event of events) await ctx.db.patch(event._id, { leadId: keeperId })

  const messages = await ctx.db
    .query("leadMessages")
    .withIndex("by_lead", (q) => q.eq("leadId", orphanId))
    .collect()
  for (const message of messages) await ctx.db.patch(message._id, { leadId: keeperId })

  await supprimerPourLead(ctx, orphanId)
  await ctx.db.delete(orphanId)
}

/**
 * E-mail connu → cette fiche. Sinon IP connue → cette fiche. Sinon null.
 * L'appelant écrit ensuite l'IP : un e-mail déjà là ne dispense pas de la
 * capturer.
 */
export async function resolveLeadIdentity(
  ctx: MutationCtx,
  args: { email?: string } & LeadGeo,
): Promise<Doc<"leads"> | null> {
  const email = args.email && args.email.length > 0 ? args.email : undefined
  const geo = leadGeoPatch(args)
  const ip = geo.ip

  const byEmail =
    email === undefined
      ? null
      : await ctx.db
          .query("leads")
          .withIndex("by_email", (q) => q.eq("email", email))
          .unique()

  const byIpRows =
    ip === undefined
      ? []
      : await ctx.db
          .query("leads")
          .withIndex("by_ip", (q) => q.eq("ip", ip))
          .collect()
  const byIp = byIpRows[0] ?? null

  if (byEmail !== null && byIp !== null && byEmail._id !== byIp._id && !byIp.email) {
    await absorbAnonymousLead(ctx, byEmail._id, byIp._id)
    return await ctx.db.get(byEmail._id)
  }
  if (byEmail !== null) return byEmail
  return byIp
}

export async function createOrLinkChatLead(
  ctx: MutationCtx,
  args: { email?: string; name?: string } & LeadGeo,
): Promise<{ leadId: Id<"leads">; created: boolean; threadId?: string }> {
  const email = args.email && args.email.length > 0 ? args.email : undefined
  const now = Date.now()
  const geo = leadGeoPatch(args)
  const existing = await resolveLeadIdentity(ctx, { email, ...args })

  if (existing !== null) {
    const patch: Record<string, unknown> = { lastMessageAt: now, ...geo }
    if (email && !existing.email) {
      patch.email = email
      if (existing.name === ANON_LEAD_NAME) {
        patch.name = displayNameFromEmail(email, args.name)
      }
    }
    await ctx.db.patch(existing._id, patch)
    return { leadId: existing._id, created: false, threadId: existing.threadId }
  }

  const name = displayNameForInsert(email, args.name)
  const leadId = await ctx.db.insert("leads", {
    name,
    ...(email ? { email } : {}),
    status: "new",
    source: "chat",
    messageCount: 0,
    lastMessageAt: now,
    ...geo,
  })
  await ctx.db.insert("leadEvents", { leadId, type: "created", to: "new" })
  const candidats = await listerCandidats(ctx)
  await ecrireCloches(ctx, {
    cle: "leadNotification",
    titre: "Nouveau chat sur le site",
    leadId,
    exclus: [],
    candidats,
  })
  await ctx.scheduler.runAfter(0, internal.leads.deliverWebhook, {
    leadId,
    name,
    email: email ?? "",
    body: "Session de chat ouverte.",
    messageCount: 0,
  })
  await ctx.scheduler.runAfter(0, internal.leads.notifyStaff, {
    name,
    email: email ?? "",
    body: "Session de chat ouverte.",
    messageCount: 0,
  })
  return { leadId, created: true }
}

import type { Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { requireChatSession } from "./chatSession"
import { leadByThreadId } from "./chatHandover"
import { isOnline, PRESENCE_ONLINE_MS } from "./presenceWindow"

export { isOnline, PRESENCE_ONLINE_MS }

export async function readThreadPresence(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
  visitorLastSeenAt: number | undefined,
): Promise<{ visitorOnline: boolean; staffOnline: boolean }> {
  const now = Date.now()
  const rows = await ctx.db
    .query("chatPresence")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .collect()
  return {
    visitorOnline: isOnline(visitorLastSeenAt, now),
    staffOnline: rows.some((row) => isOnline(row.lastSeenAt, now)),
  }
}

export async function upsertStaffPresence(
  ctx: MutationCtx,
  threadId: string,
  actorId: string,
): Promise<void> {
  const rows = await ctx.db
    .query("chatPresence")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .collect()
  const existing = rows.find((row) => row.actorId === actorId)
  const now = Date.now()
  if (existing) {
    await ctx.db.patch(existing._id, { lastSeenAt: now })
    return
  }
  await ctx.db.insert("chatPresence", { threadId, actorId, lastSeenAt: now })
}

export async function visitorHeartbeat(
  ctx: MutationCtx,
  args: { token: string },
): Promise<{ staffOnline: boolean }> {
  const session = await requireChatSession(ctx, args.token)
  if (session.leadId) {
    await ctx.db.patch(session.leadId, { visitorLastSeenAt: Date.now() })
  }
  const visitorLastSeenAt = session.leadId
    ? ((await ctx.db.get(session.leadId))?.visitorLastSeenAt as number | undefined)
    : undefined
  const presence = await readThreadPresence(ctx, session.threadId, visitorLastSeenAt)
  return { staffOnline: presence.staffOnline }
}

export async function staffPresenceForThread(
  ctx: QueryCtx,
  threadId: string,
): Promise<{
  visitorOnline: boolean
  staffOnline: boolean
  visitorLastSeenAt?: number
  staffLastSeenAt?: number
  controller: "ai" | "staff"
  leadId: Id<"leads">
}> {
  const lead = await leadByThreadId(ctx, threadId)
  const rows = await ctx.db
    .query("chatPresence")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .collect()
  const now = Date.now()
  const staffLastSeenAt = rows.reduce<number | undefined>((latest, row) => {
    if (latest === undefined || row.lastSeenAt > latest) return row.lastSeenAt
    return latest
  }, undefined)
  return {
    visitorOnline: isOnline(lead.visitorLastSeenAt, now),
    staffOnline: rows.some((row) => isOnline(row.lastSeenAt, now)),
    visitorLastSeenAt: lead.visitorLastSeenAt,
    staffLastSeenAt,
    controller: lead.controller ?? "ai",
    leadId: lead._id,
  }
}

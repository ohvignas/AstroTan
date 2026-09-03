import { saveMessage } from "@convex-dev/agent"
import { ConvexError } from "convex/values"
import { components } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { MAX_LEAD_BODY_LENGTH } from "../content"
import { nomDeLAuteur } from "./auditEvent"
import { requireRole } from "./authz"
import {
  assertChatFilename,
  chatPromptFor,
  persistChatFile,
  readStoredChatFile,
} from "./chatMedia"

function assertBounded(value: string, max: number, field: string): void {
  if (value.length > max) throw new ConvexError({ code: "TOO_LONG", field })
}

export async function leadByThreadId(ctx: QueryCtx | MutationCtx, threadId: string) {
  const lead = await ctx.db
    .query("leads")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .unique()
  if (lead === null || lead.threadId !== threadId) {
    throw new ConvexError({ code: "NOT_FOUND" })
  }
  return lead
}

export async function requireLeadWithThread(
  ctx: QueryCtx | MutationCtx,
  leadId: Id<"leads">,
) {
  const lead = await ctx.db.get(leadId)
  if (lead === null || lead.threadId === undefined) {
    throw new ConvexError({ code: "NOT_FOUND" })
  }
  return { ...lead, threadId: lead.threadId }
}

async function writeHandover(
  ctx: MutationCtx,
  args: {
    leadId: Id<"leads">
    from: "ai" | "staff"
    to: "ai" | "staff"
    actorId: string
    actorEmail: string
  },
): Promise<void> {
  await ctx.db.insert("leadEvents", {
    leadId: args.leadId,
    type: "handover",
    from: args.from,
    to: args.to,
    actorId: args.actorId,
    actorName: await nomDeLAuteur(ctx, args.actorId, args.actorEmail),
  })
}

export async function takeOverLead(ctx: MutationCtx, leadId: Id<"leads">): Promise<null> {
  const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
  const lead = await requireLeadWithThread(ctx, leadId)
  const from = lead.controller ?? "ai"
  if (from === "staff") return null
  await ctx.db.patch(leadId, { controller: "staff" })
  await writeHandover(ctx, {
    leadId,
    from,
    to: "staff",
    actorId: authUser._id,
    actorEmail: authUser.email,
  })
  return null
}

export async function releaseLeadToAi(ctx: MutationCtx, leadId: Id<"leads">): Promise<null> {
  const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
  const lead = await requireLeadWithThread(ctx, leadId)
  const from = lead.controller ?? "ai"
  if (from === "ai") return null
  await ctx.db.patch(leadId, { controller: "ai" })
  await writeHandover(ctx, {
    leadId,
    from,
    to: "ai",
    actorId: authUser._id,
    actorEmail: authUser.email,
  })
  return null
}

export async function replyAsStaff(
  ctx: MutationCtx,
  args: {
    leadId: Id<"leads">
    body: string
    storageId?: Id<"_storage">
    filename?: string
    mime?: string
  },
): Promise<{ messageId: string }> {
  const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
  const lead = await requireLeadWithThread(ctx, args.leadId)
  const body = args.body.trim()
  const file = args.storageId
    ? await readStoredChatFile(ctx, args.storageId, args.filename, args.mime)
    : null
  const filename = file ? assertChatFilename(args.filename ?? "image") : undefined
  if (body.length === 0 && file === null) throw new ConvexError({ code: "EMPTY" })
  assertBounded(body, MAX_LEAD_BODY_LENGTH, "body")

  const actorName = await nomDeLAuteur(ctx, authUser._id, authUser.email)
  const { messageId } = await saveMessage(ctx, components.agent, {
    threadId: lead.threadId,
    agentName: actorName,
    metadata: { provider: "human" },
    message: { role: "assistant", content: chatPromptFor(body, filename) },
  })
  if (file && filename) {
    await persistChatFile(ctx, {
      threadId: lead.threadId,
      messageId,
      storageId: file.storageId,
      filename,
      mime: file.mime,
      size: file.size,
    })
  }
  await ctx.db.patch(lead._id, { lastMessageAt: Date.now() })
  return { messageId }
}

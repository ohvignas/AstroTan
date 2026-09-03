import { createThread, listUIMessages, saveMessage, syncStreams } from "@convex-dev/agent"
import type { PaginationOptions } from "convex/server"
import { ConvexError } from "convex/values"
import { components, internal } from "../_generated/api"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { MAX_LEAD_BODY_LENGTH } from "../content"
import { requireRole, requireRoleFromIdentity } from "./authz"

function assertBounded(value: string, max: number, field: string): void {
  if (value.length > max) throw new ConvexError({ code: "TOO_LONG", field })
}

async function requireOwnPreview(
  ctx: MutationCtx | QueryCtx,
  threadId: string,
  userId: string,
) {
  const session = await ctx.db
    .query("agentPreviewSessions")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .unique()
  if (session === null || session.userId !== userId) {
    throw new ConvexError({ code: "INVALID_SESSION" })
  }
  return session
}

export async function startPreviewChat(ctx: MutationCtx): Promise<{ threadId: string }> {
  const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
  const existing = await ctx.db
    .query("agentPreviewSessions")
    .withIndex("by_user", (q) => q.eq("userId", authUser._id))
    .unique()
  if (existing !== null) return { threadId: existing.threadId }

  const threadId = await createThread(ctx, components.agent, {
    userId: authUser._id,
    title: "preview",
  })
  await ctx.db.insert("agentPreviewSessions", {
    threadId,
    userId: authUser._id,
    createdAt: Date.now(),
  })
  return { threadId }
}

export async function sendPreviewMessage(
  ctx: MutationCtx,
  args: { threadId: string; body: string },
): Promise<{ messageId: string }> {
  const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
  await requireOwnPreview(ctx, args.threadId, authUser._id)

  const body = args.body.trim()
  if (body.length === 0) throw new ConvexError({ code: "EMPTY" })
  assertBounded(body, MAX_LEAD_BODY_LENGTH, "body")

  const { messageId } = await saveMessage(ctx, components.agent, {
    threadId: args.threadId,
    prompt: body,
  })
  await ctx.scheduler.runAfter(0, internal.chatStream.stream, {
    threadId: args.threadId,
    promptMessageId: messageId,
    preview: true,
  })
  return { messageId }
}

export async function listPreviewMessages(
  ctx: QueryCtx,
  args: {
    threadId: string
    paginationOpts: PaginationOptions
    streamArgs?: Parameters<typeof syncStreams>[2]["streamArgs"]
  },
) {
  // Chemin identité : `requireRole` → `safeGetAuthUser` (2 runQuery) fait
  // timeout la query (plafond 1 s) au poll 1,5 s — aperçu muet, shimmer.
  const authUser = await requireRoleFromIdentity(ctx, ["owner", "admin", "editor"])
  await requireOwnPreview(ctx, args.threadId, authUser._id)

  const paginated = await listUIMessages(ctx, components.agent, {
    threadId: args.threadId,
    paginationOpts: args.paginationOpts,
  })
  const streams = await syncStreams(ctx, components.agent, {
    threadId: args.threadId,
    streamArgs: args.streamArgs,
  })
  return { ...paginated, streams }
}

export async function resetPreviewChat(ctx: MutationCtx): Promise<{ threadId: string }> {
  const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
  const threadId = await createThread(ctx, components.agent, {
    userId: authUser._id,
    title: "preview",
  })
  const existing = await ctx.db
    .query("agentPreviewSessions")
    .withIndex("by_user", (q) => q.eq("userId", authUser._id))
    .unique()
  if (existing !== null) {
    await ctx.db.patch(existing._id, { threadId, createdAt: Date.now() })
  } else {
    await ctx.db.insert("agentPreviewSessions", {
      threadId,
      userId: authUser._id,
      createdAt: Date.now(),
    })
  }
  return { threadId }
}

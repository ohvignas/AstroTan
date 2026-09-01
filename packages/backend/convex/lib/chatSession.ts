import { ConvexError } from "convex/values"
import type { Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { CHAT_SESSION_TTL_MS, signChatSessionToken, verifyChatSessionToken } from "./chatSessionToken"

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export async function issueChatSession(
  ctx: MutationCtx,
  leadId: Id<"leads">,
  threadId: string,
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + CHAT_SESSION_TTL_MS
  const token = await signChatSessionToken({
    leadId: String(leadId),
    threadId,
    expiresAt,
  })
  await ctx.db.insert("chatSessions", {
    leadId,
    threadId,
    tokenHash: await sha256Hex(token),
    expiresAt,
  })
  return { token, expiresAt }
}

export async function resolveVisitorSession(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<{
  leadId: Id<"leads">
  threadId: string
  sessionId: Id<"chatSessions">
} | null> {
  const parsed = await verifyChatSessionToken(token)
  if (parsed === null) return null
  const tokenHash = await sha256Hex(token)
  const row = await ctx.db
    .query("chatSessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique()
  if (row === null) return null
  if (row.expiresAt <= Date.now()) return null
  if (String(row.leadId) !== parsed.leadId || row.threadId !== parsed.threadId) {
    return null
  }
  return { leadId: row.leadId, threadId: row.threadId, sessionId: row._id }
}

export async function requireChatSession(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<{
  leadId: Id<"leads">
  threadId: string
  sessionId: Id<"chatSessions">
}> {
  const session = await resolveVisitorSession(ctx, token)
  if (session === null) throw new ConvexError({ code: "INVALID_SESSION" })
  return session
}

// TTL renouvelé sans tourner le hash : l'îlot garde le jeton en
// sessionStorage. Tourner le hash sans le renvoyer casserait la session.
export async function renewChatSessionTtl(
  ctx: MutationCtx,
  sessionId: Id<"chatSessions">,
): Promise<void> {
  await ctx.db.patch(sessionId, { expiresAt: Date.now() + CHAT_SESSION_TTL_MS })
}

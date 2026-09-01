import { createThread, saveMessage } from "@convex-dev/agent"
import { RateLimiter } from "@convex-dev/rate-limiter"
import { ConvexError, v } from "convex/values"
import { api, components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { mutation } from "./_generated/server"
import { MUTATION_REGISTRY } from "./_registry"
import { MAX_LEAD_BODY_LENGTH, MAX_LEAD_EMAIL_LENGTH, MAX_LEAD_NAME_LENGTH, looksLikeEmail } from "./content"
import { assertChatMessageBudget } from "./lib/chatRateLimit"
import { issueChatSession, renewChatSessionTtl, resolveVisitorSession } from "./lib/chatSession"
import {
  LEAD_EMAIL_LIMIT_CONFIG,
  LEAD_EMAIL_LIMIT_NAME,
  LEAD_ORIGIN_LIMIT_CONFIG,
  LEAD_ORIGIN_LIMIT_NAME,
} from "./lib/leadRateLimit"
import { ecrireCloches } from "./lib/notifier"
import { origineDeComptage } from "./lib/originFingerprint"
import { assertSharedSecret } from "./lib/sharedSecret"
import { listerCandidats } from "./notifications"

const limiteur = new RateLimiter(components.rateLimiter, {
  [LEAD_ORIGIN_LIMIT_NAME]: LEAD_ORIGIN_LIMIT_CONFIG,
  [LEAD_EMAIL_LIMIT_NAME]: LEAD_EMAIL_LIMIT_CONFIG,
})

function assertBounded(value: string, max: number, field: string): void {
  if (value.length > max) throw new ConvexError({ code: "TOO_LONG", field })
}

export const start = mutation({
  args: {
    secret: v.string(),
    origin: v.optional(v.string()),
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertSharedSecret(args.secret, process.env.LEAD_SUBMIT_SECRET)

    const origine = origineDeComptage(args.origin)
    const parOrigine = await limiteur.limit(ctx, LEAD_ORIGIN_LIMIT_NAME, { key: origine })
    if (!parOrigine.ok) {
      throw new ConvexError({ code: "RATE_LIMITED", retryAfter: parOrigine.retryAfter })
    }

    const email = args.email.trim().toLowerCase()
    const parEmail = await limiteur.limit(ctx, LEAD_EMAIL_LIMIT_NAME, { key: email })
    if (!parEmail.ok) {
      throw new ConvexError({ code: "RATE_LIMITED", retryAfter: parEmail.retryAfter })
    }

    assertBounded(email, MAX_LEAD_EMAIL_LENGTH, "email")
    if (!looksLikeEmail(email)) throw new ConvexError({ code: "INVALID_EMAIL" })

    const trimmed = args.name?.trim() ?? ""
    const name = trimmed.length > 0 ? trimmed : email.slice(0, email.indexOf("@"))
    assertBounded(name, MAX_LEAD_NAME_LENGTH, "name")

    const now = Date.now()
    const existing = await ctx.db
      .query("leads")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique()

    let leadId: Id<"leads">
    let threadId: string | undefined
    if (existing === null) {
      leadId = await ctx.db.insert("leads", {
        name,
        email,
        status: "new",
        source: "chat",
        messageCount: 0,
        lastMessageAt: now,
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
        email,
        body: "Session de chat ouverte.",
        messageCount: 0,
      })
      await ctx.scheduler.runAfter(0, internal.leads.notifyStaff, {
        name,
        email,
        body: "Session de chat ouverte.",
        messageCount: 0,
      })
    } else {
      leadId = existing._id
      threadId = existing.threadId
      await ctx.db.patch(leadId, { lastMessageAt: now })
    }

    if (!threadId) {
      threadId = await createThread(ctx, components.agent, {
        userId: String(leadId),
        title: email,
      })
      await ctx.db.patch(leadId, { threadId })
      await ctx.db.insert("leadEvents", { leadId, type: "chat_started" })
    }

    const { token, expiresAt } = await issueChatSession(ctx, leadId, threadId)
    return { token, leadId, threadId, expiresAt }
  },
})

export const send = mutation({
  args: {
    secret: v.string(),
    token: v.string(),
    body: v.string(),
    origin: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertSharedSecret(args.secret, process.env.LEAD_SUBMIT_SECRET)
    const session = await resolveVisitorSession(ctx, args.token)
    if (session === null) throw new ConvexError({ code: "INVALID_SESSION" })

    const body = args.body.trim()
    if (body.length === 0) throw new ConvexError({ code: "EMPTY" })
    assertBounded(body, MAX_LEAD_BODY_LENGTH, "body")

    const lead = await ctx.db.get(session.leadId)
    if (lead === null) throw new ConvexError({ code: "INVALID_SESSION" })
    await assertChatMessageBudget(ctx, args.origin, lead.email)

    const controller = lead.controller ?? "ai"
    if (controller === "ai") {
      const settings = await ctx.db.query("settings").first()
      if (settings?.agentEnabled !== true) {
        throw new ConvexError({ code: "AGENT_DISABLED" })
      }
    }

    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: session.threadId,
      prompt: body,
    })
    await ctx.db.patch(lead._id, { lastMessageAt: Date.now() })
    await renewChatSessionTtl(ctx, session.sessionId)

    if (controller === "ai") {
      await ctx.scheduler.runAfter(0, internal.chatStream.stream, {
        threadId: session.threadId,
        promptMessageId: messageId,
      })
    }
    return { messageId }
  },
})

// Porte secrète, comme `leads.submit` : aucun rôle n'est ce que `start`
// et `send` vérifient. Les trois rôles les enregistrent honnêtement.
MUTATION_REGISTRY.push({
  name: "chat.start",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: (t) =>
    t.mutation(api.chat.start, {
      secret: process.env.LEAD_SUBMIT_SECRET ?? "",
      email: `registry-chat-${Date.now()}-${Math.random()}@example.com`,
      name: "Registre",
    }),
})

MUTATION_REGISTRY.push({
  name: "chat.send",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: async (t) => {
    const { token } = await t.mutation(api.chat.start, {
      secret: process.env.LEAD_SUBMIT_SECRET ?? "",
      email: `registry-send-${Date.now()}-${Math.random()}@example.com`,
      name: "Registre",
    })
    return t.mutation(api.chat.send, {
      secret: process.env.LEAD_SUBMIT_SECRET ?? "",
      token,
      body: "message registre",
    })
  },
})

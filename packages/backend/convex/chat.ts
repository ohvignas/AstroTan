import { ConvexError, v } from "convex/values"
import { mutation } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { api, components, internal } from "./_generated/api"
import { MUTATION_REGISTRY } from "./_registry"
import { createThread } from "@convex-dev/agent"
import { RateLimiter } from "@convex-dev/rate-limiter"
import { ecrireCloches } from "./lib/notifier"
import { listerCandidats } from "./notifications"
import { assertSharedSecret } from "./lib/sharedSecret"
import {
  LEAD_EMAIL_LIMIT_CONFIG,
  LEAD_EMAIL_LIMIT_NAME,
  LEAD_ORIGIN_LIMIT_CONFIG,
  LEAD_ORIGIN_LIMIT_NAME,
} from "./lib/leadRateLimit"
import { origineDeComptage } from "./lib/originFingerprint"
import { CHAT_SESSION_TTL_MS, signChatSessionToken } from "./lib/chatSessionToken"
import { MAX_LEAD_EMAIL_LENGTH, MAX_LEAD_NAME_LENGTH, looksLikeEmail } from "./content"

const limiteur = new RateLimiter(components.rateLimiter, {
  [LEAD_ORIGIN_LIMIT_NAME]: LEAD_ORIGIN_LIMIT_CONFIG,
  [LEAD_EMAIL_LIMIT_NAME]: LEAD_EMAIL_LIMIT_CONFIG,
})

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

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
    return { token, leadId, threadId, expiresAt }
  },
})

// Porte secrète, comme `leads.submit` : aucun rôle n'est ce que `start`
// vérifie. Les trois rôles l'enregistrent honnêtement — aucun n'est refusé.
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

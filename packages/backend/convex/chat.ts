import { listUIMessages, syncStreams, vStreamArgs } from "@convex-dev/agent"
import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"
import { api, components } from "./_generated/api"
import { mutation, query, type QueryCtx } from "./_generated/server"
import { MUTATION_REGISTRY } from "./_registry"
import { requireChatSession } from "./lib/chatSession"
import {
  listPreviewMessages,
  resetPreviewChat,
  sendPreviewMessage,
  startPreviewChat,
} from "./lib/chatPreview"
import { visitorHeartbeat as beatVisitor, readThreadPresence } from "./lib/chatPresence"
import { attachChatFilesToPage, issueVisitorUploadUrl } from "./lib/chatMedia"
import { attachVisitorEmail, sendVisitorMessage, startVisitorChat } from "./lib/chatVisitor"
import { assertSharedSecret } from "./lib/sharedSecret"

export const start = mutation({
  args: {
    secret: v.string(),
    origin: v.optional(v.string()),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    ip: v.optional(v.string()),
    country: v.optional(v.string()),
    city: v.optional(v.string()),
  },
  handler: (ctx, args) => startVisitorChat(ctx, args),
})

export const attachEmail = mutation({
  args: {
    secret: v.string(),
    token: v.string(),
    origin: v.optional(v.string()),
    email: v.string(),
    name: v.optional(v.string()),
    ip: v.optional(v.string()),
    country: v.optional(v.string()),
    city: v.optional(v.string()),
  },
  handler: (ctx, args) => attachVisitorEmail(ctx, args),
})

export const send = mutation({
  args: {
    secret: v.string(),
    token: v.string(),
    body: v.string(),
    origin: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    filename: v.optional(v.string()),
    mime: v.optional(v.string()),
  },
  handler: (ctx, args) => sendVisitorMessage(ctx, args),
})

export const generateUploadUrl = mutation({
  args: { secret: v.string(), token: v.string() },
  handler: (ctx, args) => issueVisitorUploadUrl(ctx, args),
})

type VisitorStreamArgs = Parameters<typeof syncStreams>[2]["streamArgs"]

async function visitorThreadSnapshot(
  ctx: QueryCtx,
  token: string,
  paginationOpts: { numItems: number; cursor: string | null },
  streamArgs: VisitorStreamArgs,
) {
  const session = await requireChatSession(ctx, token)
  const paginated = await listUIMessages(ctx, components.agent, {
    threadId: session.threadId,
    paginationOpts,
  })
  const streams = await syncStreams(ctx, components.agent, {
    threadId: session.threadId,
    streamArgs,
  })
  const lead = session.leadId ? await ctx.db.get(session.leadId) : null
  const presence = await readThreadPresence(ctx, session.threadId, lead?.visitorLastSeenAt)
  return {
    ...paginated,
    page: await attachChatFilesToPage(ctx, session.threadId, paginated.page),
    streams,
    // Fiche IP au start ≠ e-mail donné : la carte reste jusqu'à attachEmail.
    hasLead: Boolean(lead?.email),
    staffOnline: presence.staffOnline,
  }
}

export const listVisitorMessages = query({
  args: {
    secret: v.string(),
    token: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    await assertSharedSecret(args.secret, process.env.LEAD_SUBMIT_SECRET)
    return visitorThreadSnapshot(ctx, args.token, args.paginationOpts, args.streamArgs)
  },
})

/** Jeton de session visiteur seulement — pas de secret, pour `useQuery` côté site. */
export const watchVisitorMessages = query({
  args: { token: v.string() },
  handler: (ctx, args) =>
    visitorThreadSnapshot(ctx, args.token, { numItems: 32, cursor: null }, { kind: "list" }),
})

export const visitorHeartbeat = mutation({
  args: {
    secret: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    await assertSharedSecret(args.secret, process.env.LEAD_SUBMIT_SECRET)
    return beatVisitor(ctx, { token: args.token })
  },
})

export const previewStart = mutation({
  args: {},
  handler: (ctx) => startPreviewChat(ctx),
})

export const previewSend = mutation({
  args: { threadId: v.string(), body: v.string() },
  handler: (ctx, args) => sendPreviewMessage(ctx, args),
})

export const previewListMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: (ctx, args) => listPreviewMessages(ctx, args),
})

export const previewReset = mutation({
  args: {},
  handler: (ctx) => resetPreviewChat(ctx),
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
  name: "chat.previewStart",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: (t) => t.mutation(api.chat.previewStart, {}),
})

MUTATION_REGISTRY.push({
  name: "chat.previewSend",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: async (t) => {
    const { threadId } = await t.mutation(api.chat.previewStart, {})
    return t.mutation(api.chat.previewSend, { threadId, body: "aperçu registre" })
  },
})

MUTATION_REGISTRY.push({
  name: "chat.previewReset",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: (t) => t.mutation(api.chat.previewReset, {}),
})

MUTATION_REGISTRY.push({
  name: "chat.attachEmail",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: async (t) => {
    const { token } = await t.mutation(api.chat.start, {
      secret: process.env.LEAD_SUBMIT_SECRET ?? "",
    })
    return t.mutation(api.chat.attachEmail, {
      secret: process.env.LEAD_SUBMIT_SECRET ?? "",
      token,
      email: `registry-attach-${Date.now()}-${Math.random()}@example.com`,
    })
  },
})

MUTATION_REGISTRY.push({
  name: "chat.visitorHeartbeat",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: async (t) => {
    const { token } = await t.mutation(api.chat.start, {
      secret: process.env.LEAD_SUBMIT_SECRET ?? "",
    })
    return t.mutation(api.chat.visitorHeartbeat, {
      secret: process.env.LEAD_SUBMIT_SECRET ?? "",
      token,
    })
  },
})

MUTATION_REGISTRY.push({
  name: "chat.generateUploadUrl",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: async (t) => {
    const { token } = await t.mutation(api.chat.start, {
      secret: process.env.LEAD_SUBMIT_SECRET ?? "",
    })
    return t.mutation(api.chat.generateUploadUrl, {
      secret: process.env.LEAD_SUBMIT_SECRET ?? "",
      token,
    })
  },
})

MUTATION_REGISTRY.push({
  name: "chat.send",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: async (t) => {
    // Un editor n'a pas `updateAgent` : on pose l'interrupteur hors mutation
    // pour que la matrice exerce `send`, pas le refus AGENT_DISABLED.
    await t.run(async (ctx: any) => {
      const existing = await ctx.db.query("settings").first()
      if (existing) await ctx.db.patch(existing._id, { agentEnabled: true })
      else await ctx.db.insert("settings", { siteName: "Mon site", agentEnabled: true })
    })
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

import { listUIMessages, syncStreams, vStreamArgs } from "@convex-dev/agent"
import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"
import { api, components } from "./_generated/api"
import { mutation, query } from "./_generated/server"
import { MUTATION_REGISTRY } from "./_registry"
import { requireChatSession } from "./lib/chatSession"
import { sendVisitorMessage, startVisitorChat } from "./lib/chatVisitor"
import { assertSharedSecret } from "./lib/sharedSecret"

export const start = mutation({
  args: {
    secret: v.string(),
    origin: v.optional(v.string()),
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: (ctx, args) => startVisitorChat(ctx, args),
})

export const send = mutation({
  args: {
    secret: v.string(),
    token: v.string(),
    body: v.string(),
    origin: v.optional(v.string()),
  },
  handler: (ctx, args) => sendVisitorMessage(ctx, args),
})

export const listVisitorMessages = query({
  args: {
    secret: v.string(),
    token: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    await assertSharedSecret(args.secret, process.env.LEAD_SUBMIT_SECRET)
    const session = await requireChatSession(ctx, args.token)

    const paginated = await listUIMessages(ctx, components.agent, {
      threadId: session.threadId,
      paginationOpts: args.paginationOpts,
    })
    const streams = await syncStreams(ctx, components.agent, {
      threadId: session.threadId,
      streamArgs: args.streamArgs,
    })
    return { ...paginated, streams }
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

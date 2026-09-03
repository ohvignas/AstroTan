import { listUIMessages, syncStreams, vStreamArgs } from "@convex-dev/agent"
import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"
import { api, components } from "./_generated/api"
import { mutation, query } from "./_generated/server"
import { MUTATION_REGISTRY } from "./_registry"
import { requireRole } from "./lib/authz"
import { attachChatFilesToPage } from "./lib/chatMedia"
import { leadByThreadId, releaseLeadToAi, replyAsStaff, takeOverLead } from "./lib/chatHandover"
import { staffPresenceForThread, upsertStaffPresence } from "./lib/chatPresence"

export const takeOver = mutation({
  args: { leadId: v.id("leads") },
  handler: (ctx, args) => takeOverLead(ctx, args.leadId),
})

export const releaseToAi = mutation({
  args: { leadId: v.id("leads") },
  handler: (ctx, args) => releaseLeadToAi(ctx, args.leadId),
})

export const staffReply = mutation({
  args: {
    leadId: v.id("leads"),
    body: v.string(),
    storageId: v.optional(v.id("_storage")),
    filename: v.optional(v.string()),
    mime: v.optional(v.string()),
  },
  handler: (ctx, args) => replyAsStaff(ctx, args),
})

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    return ctx.storage.generateUploadUrl()
  },
})

export const listStaffMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    await leadByThreadId(ctx, args.threadId)
    const paginated = await listUIMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    })
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    })
    return {
      ...paginated,
      page: await attachChatFilesToPage(ctx, args.threadId, paginated.page),
      streams,
    }
  },
})

export const staffHeartbeat = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    await leadByThreadId(ctx, args.threadId)
    await upsertStaffPresence(ctx, args.threadId, authUser._id)
    return null
  },
})

export const presence = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    return staffPresenceForThread(ctx, args.threadId)
  },
})

MUTATION_REGISTRY.push({
  name: "chatStaff.takeOver",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: async (t) => {
    const started = await t.mutation(api.chat.start, {
      secret: process.env.LEAD_SUBMIT_SECRET ?? "",
      email: `registry-takeover-${Date.now()}-${Math.random()}@example.com`,
      name: "Registre",
    })
    if (!started.leadId) throw new Error("lead attendu")
    return t.mutation(api.chatStaff.takeOver, { leadId: started.leadId })
  },
})

MUTATION_REGISTRY.push({
  name: "chatStaff.releaseToAi",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: async (t) => {
    const started = await t.mutation(api.chat.start, {
      secret: process.env.LEAD_SUBMIT_SECRET ?? "",
      email: `registry-release-${Date.now()}-${Math.random()}@example.com`,
      name: "Registre",
    })
    if (!started.leadId) throw new Error("lead attendu")
    await t.mutation(api.chatStaff.takeOver, { leadId: started.leadId })
    return t.mutation(api.chatStaff.releaseToAi, { leadId: started.leadId })
  },
})

MUTATION_REGISTRY.push({
  name: "chatStaff.generateUploadUrl",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: (t) => t.mutation(api.chatStaff.generateUploadUrl, {}),
})

MUTATION_REGISTRY.push({
  name: "chatStaff.staffReply",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: async (t) => {
    const started = await t.mutation(api.chat.start, {
      secret: process.env.LEAD_SUBMIT_SECRET ?? "",
      email: `registry-reply-${Date.now()}-${Math.random()}@example.com`,
      name: "Registre",
    })
    if (!started.leadId) throw new Error("lead attendu")
    return t.mutation(api.chatStaff.staffReply, {
      leadId: started.leadId,
      body: "réponse registre",
    })
  },
})

MUTATION_REGISTRY.push({
  name: "chatStaff.staffHeartbeat",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: async (t) => {
    const started = await t.mutation(api.chat.start, {
      secret: process.env.LEAD_SUBMIT_SECRET ?? "",
      email: `registry-hb-${Date.now()}-${Math.random()}@example.com`,
      name: "Registre",
    })
    return t.mutation(api.chatStaff.staffHeartbeat, { threadId: started.threadId })
  },
})

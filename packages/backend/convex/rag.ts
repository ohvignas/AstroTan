import { ConvexError, v } from "convex/values"
import { api, internal } from "./_generated/api"
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server"
import { MUTATION_REGISTRY } from "./_registry"
import { requireRole } from "./lib/authz"
import { publishedPageCandidates } from "./lib/ragSources"
import { runSiteReindex } from "./lib/runReindex"

export const indexSources = internalQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query("settings").first()
    const files = await ctx.db.query("agentKnowledgeFiles").collect()
    const pages = await ctx.db.query("pages").collect()
    return {
      leftover: settings?.agentKnowledge ?? null,
      homePageSlug: settings?.homePageSlug ?? null,
      files: files.map((file) => ({
        id: file._id,
        filename: file.filename,
        extractedMarkdown: file.extractedMarkdown,
      })),
      pages: publishedPageCandidates(pages),
    }
  },
})

export const markFileStatus = internalMutation({
  args: {
    id: v.id("agentKnowledgeFiles"),
    status: v.union(v.literal("pending"), v.literal("indexed"), v.literal("error")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if ((await ctx.db.get(args.id)) === null) return
    await ctx.db.patch(args.id, {
      indexStatus: args.status,
      indexError: args.status === "error" ? (args.error ?? "INDEX_FAILED") : undefined,
      indexedAt: args.status === "indexed" ? Date.now() : undefined,
    })
  },
})

export const markPendingExtracted = internalMutation({
  args: {},
  handler: async (ctx) => {
    const files = await ctx.db.query("agentKnowledgeFiles").collect()
    for (const file of files) {
      if (file.extractedMarkdown.trim().length === 0) continue
      await ctx.db.patch(file._id, { indexStatus: "pending", indexError: undefined })
    }
  },
})

export const markAllError = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, args) => {
    const files = await ctx.db.query("agentKnowledgeFiles").collect()
    for (const file of files) {
      await ctx.db.patch(file._id, { indexStatus: "error", indexError: args.error })
    }
  },
})

export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const files = await ctx.db.query("agentKnowledgeFiles").collect()
    const pages = publishedPageCandidates(await ctx.db.query("pages").collect())
    const times = files
      .map((file) => file.indexedAt)
      .filter((value): value is number => typeof value === "number")
    return {
      lastIndexedAt: times.length > 0 ? Math.max(...times) : null,
      publishedPageCount: pages.length,
      indexedFileCount: files.filter((file) => file.indexStatus === "indexed").length,
      fileCount: files.length,
    }
  },
})

export const reindex = action({
  args: {},
  handler: async (ctx): Promise<{ added: number; pages: number; knowledge: number }> => {
    await requireRole(ctx, ["owner", "admin"])
    await ctx.runMutation(internal.rag.markPendingExtracted, {})
    try {
      return await runSiteReindex(ctx)
    } catch (error) {
      const code =
        error && typeof error === "object" && "data" in error
          ? (error as { data?: { code?: string } }).data?.code
          : undefined
      await ctx.runMutation(internal.rag.markAllError, {
        error: code ?? "INDEX_FAILED",
      })
      throw error
    }
  },
})

export const reindexJob = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.rag.markPendingExtracted, {})
    try {
      await runSiteReindex(ctx)
    } catch (error) {
      const code =
        error && typeof error === "object" && "data" in error
          ? (error as { data?: { code?: string } }).data?.code
          : undefined
      await ctx.runMutation(internal.rag.markAllError, {
        error: code ?? "INDEX_FAILED",
      })
    }
  },
})

MUTATION_REGISTRY.push({
  name: "rag.reindex",
  allowedRoles: ["owner", "admin"],
  invoke: (t) => {
    process.env.OPENROUTER_API_KEY = "sk-or-registry-fixture"
    return t.action(api.rag.reindex, {})
  },
})

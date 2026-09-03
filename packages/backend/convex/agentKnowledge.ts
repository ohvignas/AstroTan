import { ConvexError, v } from "convex/values"
import { internal } from "./_generated/api"
import "./lib/agentKnowledgeRegistry"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import {
  MAX_AGENT_KNOWLEDGE_FILES,
  MAX_FILENAME_LENGTH,
  MAX_MEDIA_SIZE_BYTES,
} from "./content"
import { requireRole } from "./lib/authz"
import { MAX_EXTRACT_ERROR_LENGTH } from "./lib/extractErrors"
import { inferKnowledgeMime, isAllowedKnowledgeMime } from "./lib/extractKnowledge"

function assertFilename(raw: string): string {
  if (raw.length > MAX_FILENAME_LENGTH) {
    throw new ConvexError({
      code: "FIELD_TOO_LONG",
      field: "filename",
      max: MAX_FILENAME_LENGTH,
    })
  }
  const filename = raw.trim()
  if (filename.length === 0) throw new ConvexError({ code: "INVALID_FILENAME" })
  return filename
}

function assertKnowledgeFile(mimeType: string, filename: string, size: number): void {
  if (!isAllowedKnowledgeMime(mimeType, filename)) {
    throw new ConvexError({ code: "UNSUPPORTED_KNOWLEDGE_MIME", mime: mimeType })
  }
  if (size > MAX_MEDIA_SIZE_BYTES) {
    throw new ConvexError({ code: "FILE_TOO_LARGE", max: MAX_MEDIA_SIZE_BYTES })
  }
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin"])
    return ctx.storage.generateUploadUrl()
  },
})

export const attach = mutation({
  args: {
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    mediaId: v.optional(v.id("media")),
  },
  handler: async (ctx, args) => {
    const authUser = await requireRole(ctx, ["owner", "admin"])
    const filename = assertFilename(args.filename)
    const mimeType = inferKnowledgeMime(args.mimeType, filename)
    assertKnowledgeFile(mimeType, filename, args.size)
    const existing = await ctx.db.query("agentKnowledgeFiles").collect()
    if (existing.length >= MAX_AGENT_KNOWLEDGE_FILES) {
      throw new ConvexError({ code: "TOO_MANY_FILES", max: MAX_AGENT_KNOWLEDGE_FILES })
    }
    if (existing.some((row) => row.storageId === args.storageId)) {
      throw new ConvexError({ code: "ALREADY_REGISTERED" })
    }
    const id = await ctx.db.insert("agentKnowledgeFiles", {
      storageId: args.storageId,
      mediaId: args.mediaId,
      filename,
      mimeType,
      extractedMarkdown: "",
      createdBy: authUser._id,
      createdAt: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.agentKnowledgeExtract.extract, { id })
    return id
  },
})

export const remove = mutation({
  args: { id: v.id("agentKnowledgeFiles") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])
    const row = await ctx.db.get(args.id)
    if (row === null) throw new ConvexError({ code: "NOT_FOUND" })
    await ctx.db.delete(args.id)
    if (row.mediaId === undefined) await ctx.storage.delete(row.storageId)
    await ctx.scheduler.runAfter(0, internal.rag.reindexJob, {})
  },
})

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const rows = await ctx.db.query("agentKnowledgeFiles").order("desc").collect()
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        extractedMarkdown: row.extractedMarkdown,
        url: await ctx.storage.getUrl(row.storageId),
      })),
    )
  },
})

export const getFile = internalQuery({
  args: { id: v.id("agentKnowledgeFiles") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (row === null) return null
    const settings = await ctx.db.query("settings").first()
    return { ...row, openRouterOcrModel: settings?.openRouterOcrModel ?? null }
  },
})

export const patchExtracted = internalMutation({
  args: { id: v.id("agentKnowledgeFiles"), markdown: v.string() },
  handler: async (ctx, args) => {
    if ((await ctx.db.get(args.id)) === null) return
    await ctx.db.patch(args.id, {
      extractedMarkdown: args.markdown,
      extractError: undefined,
      ocrPage: undefined,
      ocrTotal: undefined,
      indexStatus: args.markdown.trim().length > 0 ? "pending" : undefined,
      indexError: undefined,
    })
    if (args.markdown.trim().length > 0) {
      await ctx.scheduler.runAfter(0, internal.rag.reindexJob, {})
    }
  },
})

export const patchOcrProgress = internalMutation({
  args: {
    id: v.id("agentKnowledgeFiles"),
    markdown: v.string(),
    ocrPage: v.number(),
    ocrTotal: v.number(),
  },
  handler: async (ctx, args) => {
    if ((await ctx.db.get(args.id)) === null) return
    await ctx.db.patch(args.id, {
      extractedMarkdown: args.markdown,
      ocrPage: args.ocrPage,
      ocrTotal: args.ocrTotal,
      extractError: undefined,
    })
  },
})

export const patchExtractFailed = internalMutation({
  args: { id: v.id("agentKnowledgeFiles"), error: v.string() },
  handler: async (ctx, args) => {
    if ((await ctx.db.get(args.id)) === null) return
    await ctx.db.patch(args.id, {
      extractError: args.error.slice(0, MAX_EXTRACT_ERROR_LENGTH),
    })
  },
})

export const retryExtract = mutation({
  args: { id: v.id("agentKnowledgeFiles") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])
    const row = await ctx.db.get(args.id)
    if (row === null) throw new ConvexError({ code: "NOT_FOUND" })
    await ctx.db.patch(args.id, {
      extractError: undefined,
      extractedMarkdown: "",
      ocrPage: undefined,
      ocrTotal: undefined,
    })
    await ctx.scheduler.runAfter(0, internal.agentKnowledgeExtract.extract, { id: args.id })
  },
})

export const reindexFile = mutation({
  args: { id: v.id("agentKnowledgeFiles") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])
    const row = await ctx.db.get(args.id)
    if (row === null) throw new ConvexError({ code: "NOT_FOUND" })
    await ctx.db.patch(args.id, {
      extractError: undefined,
      extractedMarkdown: "",
      ocrPage: undefined,
      ocrTotal: undefined,
      indexStatus: "pending",
      indexError: undefined,
    })
    await ctx.scheduler.runAfter(0, internal.agentKnowledgeExtract.extract, { id: args.id })
  },
})

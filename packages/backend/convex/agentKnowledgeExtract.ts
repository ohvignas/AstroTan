import { v } from "convex/values"
import { internal } from "./_generated/api"
import { internalAction } from "./_generated/server"
import { EXTRACT_ERRORS, describeExtractFailure } from "./lib/extractErrors"
import { extractKnowledgeMarkdown, isTextKnowledgeFile } from "./lib/extractKnowledge"

export const extract = internalAction({
  args: { id: v.id("agentKnowledgeFiles") },
  handler: async (ctx, args) => {
    try {
      const row = await ctx.runQuery(internal.agentKnowledge.getFile, { id: args.id })
      if (row === null) return
      const blob = await ctx.storage.get(row.storageId)
      if (blob === null) {
        await ctx.runMutation(internal.agentKnowledge.patchExtractFailed, {
          id: args.id,
          error: EXTRACT_ERRORS.missing,
        })
        return
      }
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (isTextKnowledgeFile(row.mimeType, row.filename)) {
        const markdown = extractKnowledgeMarkdown(bytes, row.mimeType, row.filename)
        await ctx.runMutation(internal.agentKnowledge.patchExtracted, {
          id: args.id,
          markdown,
        })
        return
      }
      await ctx.runAction(internal.agentKnowledgeExtractNode.extractBinary, {
        id: args.id,
      })
    } catch (error) {
      console.error("[extract]", error instanceof Error ? error.message : error)
      await ctx.runMutation(internal.agentKnowledge.patchExtractFailed, {
        id: args.id,
        error: describeExtractFailure(error),
      })
    }
  },
})

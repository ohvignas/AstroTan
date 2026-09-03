"use node"

import { v } from "convex/values"
import { internal } from "./_generated/api"
import { internalAction } from "./_generated/server"
import { MAX_AGENT_KNOWLEDGE_FILE_MARKDOWN, MAX_MEDIA_SIZE_BYTES } from "./content"
import {
  EXTRACT_ERRORS,
  ExtractFailure,
  describeExtractFailure,
  withExtractTimeout,
} from "./lib/extractErrors"
import { extractKnowledgeMarkdown, isTextKnowledgeFile } from "./lib/extractKnowledge"
import { isolatePdfBytes } from "./lib/extractPdf"
import { extractPdfForKnowledge, extractPdfStep } from "./lib/extractPdfKnowledge"
import { OCR_TIMEOUT_MS } from "./lib/extractPdfOcr"
import { resolveOpenRouterOcrModel } from "./lib/openRouterOcrModels"
import { lireSecret } from "./secrets"

export const extractBinary = internalAction({
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
      const buffer = Buffer.from(await blob.arrayBuffer())
      if (isTextKnowledgeFile(row.mimeType, row.filename)) {
        const markdown = extractKnowledgeMarkdown(
          new Uint8Array(buffer),
          row.mimeType,
          row.filename,
        )
        await ctx.runMutation(internal.agentKnowledge.patchExtracted, {
          id: args.id,
          markdown,
        })
        return
      }
      const apiKey = await lireSecret(ctx, "OPENROUTER_API_KEY")
      const model = resolveOpenRouterOcrModel(row.openRouterOcrModel)
      const lower = row.filename.toLowerCase()
      const isPdf = row.mimeType === "application/pdf" || lower.endsWith(".pdf")
      if (isPdf) {
        if (buffer.byteLength > MAX_MEDIA_SIZE_BYTES) throw new ExtractFailure("tooLarge")
        const step = await withExtractTimeout(
          extractPdfStep(isolatePdfBytes(new Uint8Array(buffer)), {
            apiKey,
            model,
            filename: row.filename,
            ocrPage: row.ocrPage ?? 0,
            priorMarkdown: (row.ocrPage ?? 0) > 0 ? row.extractedMarkdown : "",
          }),
          OCR_TIMEOUT_MS,
        )
        if (step.status === "continue") {
          const markdown = step.markdown.slice(0, MAX_AGENT_KNOWLEDGE_FILE_MARKDOWN)
          await ctx.runMutation(internal.agentKnowledge.patchOcrProgress, {
            id: args.id,
            markdown,
            ocrPage: step.ocrPage,
            ocrTotal: step.ocrTotal,
          })
          if (markdown.length >= MAX_AGENT_KNOWLEDGE_FILE_MARKDOWN) {
            await ctx.runMutation(internal.agentKnowledge.patchExtracted, {
              id: args.id,
              markdown,
            })
            return
          }
          await ctx.scheduler.runAfter(0, internal.agentKnowledgeExtractNode.extractBinary, {
            id: args.id,
          })
          return
        }
        await ctx.runMutation(internal.agentKnowledge.patchExtracted, {
          id: args.id,
          markdown: step.markdown.slice(0, MAX_AGENT_KNOWLEDGE_FILE_MARKDOWN),
        })
        return
      }
      const markdown = await extractBinaryMarkdown(buffer, row.mimeType, row.filename, {
        apiKey,
        model,
      })
      await ctx.runMutation(internal.agentKnowledge.patchExtracted, {
        id: args.id,
        markdown: markdown.slice(0, MAX_AGENT_KNOWLEDGE_FILE_MARKDOWN),
      })
    } catch (error) {
      console.error("[extractBinary]", error instanceof Error ? error.message : error)
      await ctx.runMutation(internal.agentKnowledge.patchExtractFailed, {
        id: args.id,
        error: describeExtractFailure(error),
      })
    }
  },
})

export async function extractBinaryMarkdown(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  ocr: { apiKey: string | null; model: string },
): Promise<string> {
  if (buffer.byteLength > MAX_MEDIA_SIZE_BYTES) throw new ExtractFailure("tooLarge")
  const lower = filename.toLowerCase()
  const isPdf = mimeType === "application/pdf" || lower.endsWith(".pdf")
  return withExtractTimeout(
    (async () => {
      if (isPdf) {
        return extractPdfForKnowledge(isolatePdfBytes(new Uint8Array(buffer)), {
          apiKey: ocr.apiKey,
          model: ocr.model,
          filename,
        })
      }
      if (
        mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        lower.endsWith(".docx")
      ) {
        const { createRequire } = await import("node:module")
        const mammoth = createRequire(import.meta.url)("mammoth") as {
          extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>
        }
        const text = (await mammoth.extractRawText({ buffer })).value.trim()
        if (text.length === 0) throw new ExtractFailure("empty")
        return text
      }
      throw new ExtractFailure("parse")
    })(),
    isPdf ? OCR_TIMEOUT_MS : undefined,
  )
}

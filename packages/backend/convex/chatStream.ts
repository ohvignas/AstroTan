import { saveMessage } from "@convex-dev/agent"
import type { ToolSet } from "ai"
import { v } from "convex/values"
import { components, internal } from "./_generated/api"
import { internalAction, internalQuery, type ActionCtx } from "./_generated/server"
import { visitorPageTools } from "./lib/agentTools"
import { calendarTools } from "./lib/calendarTools"
import { knowledgeTools } from "./lib/knowledgeTools"
import { concatKnowledgeMarkdown } from "./lib/concatKnowledge"
import { createMcpMetaTools } from "./lib/mcpMetaTools"
import {
  STREAM_FALLBACK_TEXT,
  STREAM_RETRY_TIMEOUT_MS,
  STREAM_TEXT_TIMEOUT_MS,
  STREAM_WITH_MCP_TIMEOUT_MS,
  planStreamRecovery,
  runStreamTextBounded,
  shouldWriteStreamFallback,
  wrapToolExecutes,
} from "./lib/streamTools"
import { makeVisitorAgent } from "./lib/visitorAgent"
import { lireSecret } from "./secrets"

export const getAgentConfig = internalQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query("settings").first()
    const files = await ctx.db.query("agentKnowledgeFiles").collect()
    return {
      agentKnowledge: concatKnowledgeMarkdown(
        files.map((file) => ({
          filename: file.filename,
          extractedMarkdown: file.extractedMarkdown,
        })),
        settings?.agentKnowledge,
      ),
      openRouterModel: settings?.openRouterModel ?? null,
      agentEnabled: settings?.agentEnabled === true,
      siteName: settings?.siteName ?? null,
      agentDisplayName: settings?.agentDisplayName ?? null,
      agentInstructions: settings?.agentInstructions ?? null,
    }
  },
})

export const publishedPageIndex = internalQuery({
  args: {},
  handler: async (ctx) => {
    const pages = await ctx.db
      .query("pages")
      .withIndex("by_status", (q) => q.eq("status", "published"))
      .collect()
    return pages
      .filter((page) => page.status === "published")
      .map((page) => ({ title: page.title, slug: page.slug }))
  },
})

export const publishedPageBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("pages")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique()
    if (page === null || page.status !== "published") return null
    const settings = await ctx.db.query("settings").first()
    return {
      title: page.title,
      slug: page.slug,
      homePageSlug: settings?.homePageSlug ?? null,
    }
  },
})

export const leadEmailForThread = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const lead = await ctx.db
      .query("leads")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .unique()
    return lead?.email ?? null
  },
})

export const stream = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    preview: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    try {
      const enabled = await ctx.runQuery(internal.mcpServers.enabledForStream, {})
      const mcpTools =
        enabled.length > 0
          ? wrapToolExecutes(
              createMcpMetaTools(ctx, async (transport) => {
                const { createMCPClient } = await import("@ai-sdk/mcp")
                return createMCPClient(transport)
              }),
            )
          : {}
      const refresh = await lireSecret(ctx, "GOOGLE_CALENDAR_REFRESH_TOKEN")
      const localTools: ToolSet = {
        ...visitorPageTools,
        ...(refresh ? calendarTools : {}),
        ...knowledgeTools,
      }
      const mcpToolCount = Object.keys(mcpTools).length
      const preview = args.preview === true
      let outcome = await streamOnce(
        ctx,
        args,
        { ...localTools, ...mcpTools },
        preview,
        mcpToolCount > 0 ? STREAM_WITH_MCP_TIMEOUT_MS : STREAM_TEXT_TIMEOUT_MS,
      )
      if (!outcome.ok) {
        const recovery = planStreamRecovery({
          error: outcome.error,
          mcpToolCount,
          alreadyRetriedWithoutMcp: false,
        })
        if (recovery === "retry-without-mcp") {
          console.warn(
            `chatStream: ${formatStreamError(outcome.error)} — retry without ${mcpToolCount} MCP tools`,
          )
          outcome = await streamOnce(ctx, args, localTools, preview, STREAM_RETRY_TIMEOUT_MS)
        }
      }
      if (!outcome.ok) {
        if (!shouldWriteStreamFallback(outcome.error)) throw outcome.error
        console.warn(`chatStream: ${formatStreamError(outcome.error)}`)
        await writeStreamFallback(ctx, args.threadId)
      }
    } catch (error) {
      if (!shouldWriteStreamFallback(error)) throw error
      console.warn(`chatStream: ${formatStreamError(error)}`)
      await writeStreamFallback(ctx, args.threadId)
    }
  },
})

function formatStreamError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function writeStreamFallback(ctx: ActionCtx, threadId: string) {
  await saveMessage(ctx, components.agent, {
    threadId,
    message: { role: "assistant", content: STREAM_FALLBACK_TEXT },
  })
}

async function streamOnce(
  ctx: ActionCtx,
  args: { threadId: string; promptMessageId: string },
  tools: ToolSet,
  preview: boolean,
  timeoutMs: number,
) {
  const agent = await makeVisitorAgent(ctx, tools, { preview })
  const controller = new AbortController()
  const work = agent.streamText(
    ctx,
    { threadId: args.threadId },
    {
      promptMessageId: args.promptMessageId,
      abortSignal: controller.signal,
    },
    { saveStreamDeltas: true },
  )
  return runStreamTextBounded(work, controller, timeoutMs)
}

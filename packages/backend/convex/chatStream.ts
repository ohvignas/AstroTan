import { v } from "convex/values"
import { internalAction, internalQuery } from "./_generated/server"
import { visitorPageTools } from "./lib/agentTools"
import { makeVisitorAgent } from "./lib/visitorAgent"

export const getAgentConfig = internalQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query("settings").first()
    return {
      agentKnowledge: settings?.agentKnowledge ?? null,
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

export const stream = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    const agent = await makeVisitorAgent(ctx, visitorPageTools)
    await agent.streamText(
      ctx,
      { threadId: args.threadId },
      { promptMessageId: args.promptMessageId },
      { saveStreamDeltas: true },
    )
  },
})

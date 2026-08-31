import { v } from "convex/values"
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server"
import { api } from "./_generated/api"
import { requireRole } from "./lib/authz"
import { MUTATION_REGISTRY } from "./_registry"
import { rankForDocument, readSiteSnapshot } from "./lib/seoRanksQueries"
import { executerRelever } from "./lib/seoRelever"
import { executerRefreshWeekly } from "./lib/seoWeekly"
import {
  replaceKeywordRows,
  upsertBacklinksRow,
  upsertRankRow,
} from "./lib/seoRanksWrite"

const kindValidator = v.union(v.literal("page"), v.literal("post"))

export const forDocument = query({
  args: {
    kind: kindValidator,
    pageId: v.optional(v.id("pages")),
    postId: v.optional(v.id("posts")),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    return rankForDocument(ctx, args)
  },
})

export const siteSnapshot = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    return readSiteSnapshot(ctx)
  },
})

export const rowFor = internalQuery({
  args: {
    kind: kindValidator,
    pageId: v.optional(v.id("pages")),
    postId: v.optional(v.id("posts")),
  },
  handler: async (ctx, args) => {
    if (args.kind === "page" && args.pageId) {
      return ctx.db
        .query("seoRanks")
        .withIndex("by_page", (q) => q.eq("pageId", args.pageId))
        .unique()
    }
    if (args.kind === "post" && args.postId) {
      return ctx.db
        .query("seoRanks")
        .withIndex("by_post", (q) => q.eq("postId", args.postId))
        .unique()
    }
    return null
  },
})

export const settingsForSeo = internalQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query("settings").first()
    return {
      declaredDomain: settings?.declaredDomain,
      homePageSlug: settings?.homePageSlug,
      serpLocationCode: settings?.serpLocationCode,
      serpLanguageCode: settings?.serpLanguageCode,
    }
  },
})

export const publishedTargets = internalQuery({
  args: {},
  handler: async (ctx) => {
    const pages = await ctx.db
      .query("pages")
      .withIndex("by_status", (q) => q.eq("status", "published"))
      .collect()
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .collect()
    return [
      ...pages
        .filter((p) => (p.targetKeyword ?? "").trim().length > 0)
        .map((p) => ({
          kind: "page" as const,
          pageId: p._id,
          postId: undefined,
          slug: p.slug,
          keyword: p.targetKeyword as string,
        })),
      ...posts
        .filter((p) => (p.targetKeyword ?? "").trim().length > 0)
        .map((p) => ({
          kind: "post" as const,
          pageId: undefined,
          postId: p._id,
          slug: p.slug,
          keyword: p.targetKeyword as string,
        })),
    ]
  },
})

export const upsertRank = internalMutation({
  args: {
    kind: kindValidator,
    pageId: v.optional(v.id("pages")),
    postId: v.optional(v.id("posts")),
    keyword: v.string(),
    url: v.string(),
    status: v.union(
      v.literal("ranked"),
      v.literal("out_of_top_100"),
      v.literal("other_url"),
    ),
    position: v.optional(v.number()),
    rankedUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await upsertRankRow(ctx, args)
  },
})

export const replaceSiteKeywords = internalMutation({
  args: {
    rows: v.array(
      v.object({ keyword: v.string(), position: v.number(), url: v.string() }),
    ),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await replaceKeywordRows(ctx, args)
  },
})

export const upsertSiteBacklinks = internalMutation({
  args: {
    backlinks: v.number(),
    referringDomains: v.number(),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await upsertBacklinksRow(ctx, args)
  },
})

export const relever = action({
  args: {
    kind: kindValidator,
    pageId: v.optional(v.id("pages")),
    postId: v.optional(v.id("posts")),
  },
  handler: async (ctx, args) => executerRelever(ctx, args, { throttle: true }),
})

export const refreshWeekly = internalAction({
  args: {},
  handler: async (ctx) => {
    await executerRefreshWeekly(ctx)
  },
})

MUTATION_REGISTRY.push({
  name: "seoRanks.relever",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: (t) => t.action(api.seoRanks.relever, { kind: "page" }),
})

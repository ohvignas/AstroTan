import { ConvexError } from "convex/values"
import type { MutationCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { MAX_CANONICAL_URL_LENGTH, MAX_TARGET_KEYWORD_LENGTH } from "../content"
import { insererReleve } from "./seoSiteHistory"

function bound(value: string, max: number, field: string) {
  if (value.length > max) {
    throw new ConvexError({ code: "FIELD_TOO_LONG", field, max })
  }
  return value
}

export async function upsertRankRow(
  ctx: MutationCtx,
  args: {
    kind: "page" | "post"
    pageId?: Id<"pages">
    postId?: Id<"posts">
    keyword: string
    url: string
    status: "ranked" | "out_of_top_100" | "other_url"
    position?: number
    rankedUrl?: string
  },
) {
  const keyword = bound(args.keyword, MAX_TARGET_KEYWORD_LENGTH, "keyword")
  const url = bound(args.url, MAX_CANONICAL_URL_LENGTH, "url")
  const rankedUrl =
    args.rankedUrl === undefined
      ? undefined
      : bound(args.rankedUrl, MAX_CANONICAL_URL_LENGTH, "rankedUrl")
  const existing =
    args.kind === "page" && args.pageId
      ? await ctx.db
          .query("seoRanks")
          .withIndex("by_page", (q) => q.eq("pageId", args.pageId))
          .unique()
      : args.kind === "post" && args.postId
        ? await ctx.db
            .query("seoRanks")
            .withIndex("by_post", (q) => q.eq("postId", args.postId))
            .unique()
        : null
  const now = Date.now()
  const next = {
    kind: args.kind,
    pageId: args.pageId,
    postId: args.postId,
    keyword,
    url,
    status: args.status,
    position: args.position,
    rankedUrl,
    fetchedAt: now,
  }
  if (existing === null) {
    await ctx.db.insert("seoRanks", next)
    return
  }
  await ctx.db.patch(existing._id, {
    ...next,
    previousPosition: existing.position,
    previousFetchedAt: existing.fetchedAt,
  })
}

export async function replaceKeywordRows(
  ctx: MutationCtx,
  args: {
    rows: { keyword: string; position: number; url: string }[]
    fetchedAt: number
  },
) {
  const old = await ctx.db.query("seoSiteKeywords").collect()
  for (const row of old) await ctx.db.delete(row._id)
  for (const row of args.rows.slice(0, 50)) {
    await ctx.db.insert("seoSiteKeywords", {
      keyword: bound(row.keyword, MAX_TARGET_KEYWORD_LENGTH, "keyword"),
      position: row.position,
      url: bound(row.url, MAX_CANONICAL_URL_LENGTH, "url"),
      fetchedAt: args.fetchedAt,
    })
  }
  const count = Math.min(args.rows.length, 50)
  await insererReleve(ctx, "keywords", count, args.fetchedAt)
  if (count > 0) {
    const avg =
      args.rows.slice(0, 50).reduce((sum, row) => sum + row.position, 0) / count
    await insererReleve(ctx, "position", avg, args.fetchedAt)
  }
}

export async function upsertBacklinksRow(
  ctx: MutationCtx,
  args: { backlinks: number; referringDomains: number; fetchedAt: number },
) {
  const existing = await ctx.db.query("seoSiteBacklinks").first()
  if (existing === null) {
    await ctx.db.insert("seoSiteBacklinks", args)
  } else {
    await ctx.db.patch(existing._id, {
      backlinks: args.backlinks,
      referringDomains: args.referringDomains,
      backlinksPrev: existing.backlinks,
      referringDomainsPrev: existing.referringDomains,
      fetchedAt: args.fetchedAt,
    })
  }
  await insererReleve(ctx, "backlinks", args.backlinks, args.fetchedAt)
}

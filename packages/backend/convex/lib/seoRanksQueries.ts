import { ConvexError } from "convex/values"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { dataforseoEstConfigure } from "./dataforseoConfigured"
import { documentRank } from "./seoRankState"
import { assembleSiteSnapshot } from "./seoSnapshot"
import { assemblerSeries, insererReleve } from "./seoSiteHistory"

type DbCtx = QueryCtx | MutationCtx

export async function loadDocument(
  ctx: QueryCtx,
  args: { kind: "page" | "post"; pageId?: Id<"pages">; postId?: Id<"posts"> },
) {
  if (args.kind === "page") {
    if (!args.pageId) throw new ConvexError({ code: "NOT_FOUND" })
    const page = await ctx.db.get(args.pageId)
    if (!page) throw new ConvexError({ code: "NOT_FOUND" })
    return { kind: "page" as const, doc: page }
  }
  if (!args.postId) throw new ConvexError({ code: "NOT_FOUND" })
  const post = await ctx.db.get(args.postId)
  if (!post) throw new ConvexError({ code: "NOT_FOUND" })
  return { kind: "post" as const, doc: post }
}

export async function rankForDocument(
  ctx: QueryCtx,
  args: { kind: "page" | "post"; pageId?: Id<"pages">; postId?: Id<"posts"> },
) {
  const { kind, doc } = await loadDocument(ctx, args)
  const row =
    kind === "page"
      ? await ctx.db
          .query("seoRanks")
          .withIndex("by_page", (q) => q.eq("pageId", doc._id as Id<"pages">))
          .unique()
      : await ctx.db
          .query("seoRanks")
          .withIndex("by_post", (q) => q.eq("postId", doc._id as Id<"posts">))
          .unique()
  return documentRank({
    targetKeyword: doc.targetKeyword,
    dfsConfigured: await dataforseoEstConfigure(ctx),
    draft: doc.status !== "published",
    row,
    now: Date.now(),
  })
}

export async function readSiteSnapshot(ctx: DbCtx) {
  const settings = await ctx.db.query("settings").first()
  const pages = await ctx.db
    .query("pages")
    .withIndex("by_status", (q) => q.eq("status", "published"))
    .collect()
  const posts = await ctx.db
    .query("posts")
    .withIndex("by_status_published", (q) => q.eq("status", "published"))
    .collect()
  const keywordByPage = new Map(
    pages.filter((p) => p.targetKeyword).map((p) => [p._id, p.targetKeyword as string]),
  )
  const keywordByPost = new Map(
    posts.filter((p) => p.targetKeyword).map((p) => [p._id, p.targetKeyword as string]),
  )
  const ranks = await ctx.db.query("seoRanks").collect()
  const rankedPositions = ranks
    .filter((r) => {
      if (r.status !== "ranked" || r.position === undefined) return false
      if (r.kind === "page" && r.pageId) return keywordByPage.get(r.pageId) === r.keyword
      if (r.kind === "post" && r.postId) return keywordByPost.get(r.postId) === r.keyword
      return false
    })
    .map((r) => ({ position: r.position as number, previousPosition: r.previousPosition }))
  return assembleSiteSnapshot({
    configured: await dataforseoEstConfigure(ctx as QueryCtx),
    declaredDomain: settings?.declaredDomain ?? null,
    rankedPositions,
    keywords: await ctx.db.query("seoSiteKeywords").collect(),
    backlinks: await ctx.db.query("seoSiteBacklinks").first(),
  })
}

export async function readSiteSeries(ctx: DbCtx, startAt: number, endAt: number) {
  const history = await ctx.db.query("seoSiteHistory").collect()
  const snap = await readSiteSnapshot(ctx)
  const ranks = await ctx.db.query("seoRanks").collect()
  const keywords = await ctx.db.query("seoSiteKeywords").collect()
  const backlinks = await ctx.db.query("seoSiteBacklinks").first()
  const positionFetchedAt = ranks.reduce((max, row) => Math.max(max, row.fetchedAt), 0)
  const keywordsFetchedAt = keywords.reduce(
    (max, row) => Math.max(max, row.fetchedAt),
    0,
  )
  return assemblerSeries({
    history: history.map((row) => ({
      metric: row.metric,
      fetchedAt: row.fetchedAt,
      value: row.value,
    })),
    fallback: {
      position:
        snap.averagePosition !== null && positionFetchedAt > 0
          ? { fetchedAt: positionFetchedAt, value: snap.averagePosition }
          : undefined,
      backlinks: backlinks
        ? { fetchedAt: backlinks.fetchedAt, value: backlinks.backlinks }
        : undefined,
      keywords:
        keywordsFetchedAt > 0
          ? { fetchedAt: keywordsFetchedAt, value: snap.keywordCount }
          : undefined,
    },
    startAt,
    endAt,
  })
}

export async function enregistrerMoyennePosition(ctx: MutationCtx, fetchedAt: number) {
  const snap = await readSiteSnapshot(ctx)
  if (snap.averagePosition === null) return
  await insererReleve(ctx, "position", snap.averagePosition, fetchedAt)
}

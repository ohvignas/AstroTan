import { ConvexError } from "convex/values"
import type { ActionCtx } from "../_generated/server"
import { api, internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { requireOwnDocument, requireRole } from "./authz"
import { exigerPasDemo } from "./demoSandbox"
import { lireSecret } from "../secrets"
import { publicPath, publicUrl } from "./publicPath"
import { origineCibleStats } from "./refreshCible"
import { resolveSerpLocale } from "./serpLocale"
import { interpretOrganic, matchValue } from "./dataforseoSerp"
import { fetchSerp } from "./dataforseoFetch"
import { RELEVER_THROTTLE_MS } from "./seoRankState"

export type ReleverResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "draft" | "no_keyword" | "dfs_absent" | "throttled" | "unreachable" | "refuse" }

export async function executerRelever(
  ctx: ActionCtx,
  args: { kind: "page" | "post"; pageId?: Id<"pages">; postId?: Id<"posts"> },
  opts: { throttle: boolean },
): Promise<ReleverResult> {
  const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
  const env = process.env
  exigerPasDemo(authUser, env)
  const doc =
    args.kind === "page" && args.pageId
      ? await ctx.runQuery(api.pages.get, { id: args.pageId })
      : args.kind === "post" && args.postId
        ? await ctx.runQuery(api.posts.get, { id: args.postId })
        : null
  if (!doc) return { ok: false, reason: "not_found" }
  requireOwnDocument(authUser, doc)
  if (doc.status !== "published") return { ok: false, reason: "draft" }
  const keyword = doc.targetKeyword?.trim() ?? ""
  if (keyword.length === 0) return { ok: false, reason: "no_keyword" }

  const [login, password] = await Promise.all([
    lireSecret(ctx, "DATAFORSEO_LOGIN"),
    lireSecret(ctx, "DATAFORSEO_PASSWORD"),
  ])
  if (!login || !password) return { ok: false, reason: "dfs_absent" }

  const existing = await ctx.runQuery(internal.seoRanks.rowFor, {
    kind: args.kind,
    pageId: args.pageId,
    postId: args.postId,
  })
  if (
    opts.throttle &&
    existing &&
    Date.now() - existing.fetchedAt < RELEVER_THROTTLE_MS
  ) {
    return { ok: false, reason: "throttled" }
  }

  const settings = await ctx.runQuery(api.settings.getPrivate, {})
  const origin = origineCibleStats({
    declaredDomain: settings?.declaredDomain,
    webSiteUrl: process.env.WEB_SITE_URL,
  })
  if (!origin) return { ok: false, reason: "unreachable" }

  const path =
    args.kind === "page"
      ? publicPath(doc.slug, settings?.homePageSlug)
      : `/blog/${doc.slug}`
  const url =
    args.kind === "page"
      ? publicUrl(origin, doc.slug, settings?.homePageSlug)
      : `${origin.replace(/\/+$/, "")}/blog/${doc.slug}`
  let host: string
  try {
    host = settings?.declaredDomain ?? new URL(url).hostname
  } catch {
    return { ok: false, reason: "unreachable" }
  }
  const locale = resolveSerpLocale({
    serpLocationCode: settings?.serpLocationCode ?? undefined,
    serpLanguageCode: settings?.serpLanguageCode ?? undefined,
  })

  const items = await fetchSerp({
    login,
    password,
    keyword,
    locationCode: locale.locationCode,
    languageCode: locale.languageCode,
    matchValue: matchValue(host, path),
  })
  if (items === null) return { ok: false, reason: "unreachable" }

  const verdict = interpretOrganic({ items, targetUrl: url, ourHost: host })
  await ctx.runMutation(internal.seoRanks.upsertRank, {
    kind: args.kind,
    pageId: args.pageId,
    postId: args.postId,
    keyword,
    url,
    ...verdict,
  })
  await ctx.runMutation(internal.seoRanks.recordPositionHistory, {
    fetchedAt: Date.now(),
  })
  return { ok: true }
}

export function assertReleverArgs(args: {
  kind: "page" | "post"
  pageId?: Id<"pages">
  postId?: Id<"posts">
}) {
  if (args.kind === "page" && !args.pageId) throw new ConvexError({ code: "NOT_FOUND" })
  if (args.kind === "post" && !args.postId) throw new ConvexError({ code: "NOT_FOUND" })
}

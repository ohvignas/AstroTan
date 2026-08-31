import type { ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import { lireSecret } from "../secrets"
import { resolveSerpLocale } from "./serpLocale"
import { interpretLabs, interpretOrganic, interpretOverview, matchValue } from "./dataforseoSerp"
import { fetchLabs, fetchOverview, fetchSerp } from "./dataforseoFetch"
import { publicPath, publicUrl } from "./publicPath"

export async function executerRefreshWeekly(ctx: ActionCtx): Promise<void> {
  const [login, password] = await Promise.all([
    lireSecret(ctx, "DATAFORSEO_LOGIN"),
    lireSecret(ctx, "DATAFORSEO_PASSWORD"),
  ])
  if (!login || !password) return

  const settings = await ctx.runQuery(internal.seoRanks.settingsForSeo, {})
  const locale = resolveSerpLocale(settings)
  const origin =
    process.env.WEB_SITE_URL ||
    (settings.declaredDomain ? `https://${settings.declaredDomain}` : "")

  if (settings.declaredDomain) {
    const labs = await fetchLabs({
      login,
      password,
      target: settings.declaredDomain,
      locationCode: locale.locationCode,
      languageCode: locale.languageCode,
    })
    if (labs) {
      await ctx.runMutation(internal.seoRanks.replaceSiteKeywords, {
        rows: interpretLabs(labs).slice(0, 50),
        fetchedAt: Date.now(),
      })
    }
    const overview = await fetchOverview({
      login,
      password,
      target: settings.declaredDomain,
    })
    const counts = overview ? interpretOverview(overview) : null
    if (counts) {
      await ctx.runMutation(internal.seoRanks.upsertSiteBacklinks, {
        ...counts,
        fetchedAt: Date.now(),
      })
    }
  }

  if (!origin) return
  const targets = await ctx.runQuery(internal.seoRanks.publishedTargets, {})
  for (const target of targets) {
    const path =
      target.kind === "page"
        ? publicPath(target.slug, settings.homePageSlug)
        : `/blog/${target.slug}`
    const url =
      target.kind === "page"
        ? publicUrl(origin, target.slug, settings.homePageSlug)
        : `${origin.replace(/\/+$/, "")}/blog/${target.slug}`
    let host: string
    try {
      host = settings.declaredDomain ?? new URL(url).hostname
    } catch {
      continue
    }
    const items = await fetchSerp({
      login,
      password,
      keyword: target.keyword,
      locationCode: locale.locationCode,
      languageCode: locale.languageCode,
      matchValue: matchValue(host, path),
    })
    if (items === null) continue
    const verdict = interpretOrganic({ items, targetUrl: url, ourHost: host })
    await ctx.runMutation(internal.seoRanks.upsertRank, {
      kind: target.kind,
      pageId: target.pageId,
      postId: target.postId,
      keyword: target.keyword,
      url,
      ...verdict,
    })
  }
}

import type { ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import { lireSecret } from "../secrets"
import { resolveSerpLocale } from "./serpLocale"
import { interpretLabs, interpretOrganic, interpretOverview, matchValue } from "./dataforseoSerp"
import { fetchLabs, fetchOverview, fetchSerp } from "./dataforseoFetch"
import { publicPath, publicUrl } from "./publicPath"
import { cibleApex, doitEssayerJumeau, hoteJumeauWww, origineCibleStats } from "./refreshCible"

export type RefreshSiteResult =
  | { ok: true; fetchedAt: number }
  | { ok: true; skipped: "dfs_absent" | "no_domain" }
  | { ok: false; reason: "unreachable" | "keywords" | "backlinks" }

export async function executerRefreshSiteSnapshot(
  ctx: ActionCtx,
): Promise<RefreshSiteResult> {
  const [login, password] = await Promise.all([
    lireSecret(ctx, "DATAFORSEO_LOGIN"),
    lireSecret(ctx, "DATAFORSEO_PASSWORD"),
  ])
  if (!login || !password) return { ok: true, skipped: "dfs_absent" }

  const settings = await ctx.runQuery(internal.seoRanks.settingsForSeo, {})
  if (!settings.declaredDomain) return { ok: true, skipped: "no_domain" }

  const locale = resolveSerpLocale(settings)
  const fetchedAt = Date.now()
  const apex = cibleApex(settings.declaredDomain)
  const premier = await tirerSnapshot(login, password, apex, locale)
  const snapshot = doitEssayerJumeau(premier)
    ? await tirerSnapshot(login, password, hoteJumeauWww(apex), locale)
    : premier
  if (!snapshot.labsOk && snapshot.counts === null) {
    return { ok: false, reason: "unreachable" }
  }

  if (snapshot.labsOk) {
    await ctx.runMutation(internal.seoRanks.replaceSiteKeywords, {
      rows: snapshot.rows,
      fetchedAt,
    })
  }
  if (snapshot.counts) {
    await ctx.runMutation(internal.seoRanks.upsertSiteBacklinks, {
      ...snapshot.counts,
      fetchedAt,
    })
  }
  if (!snapshot.labsOk) return { ok: false, reason: "keywords" }
  if (snapshot.counts === null) return { ok: false, reason: "backlinks" }
  return { ok: true, fetchedAt }
}

async function tirerSnapshot(
  login: string,
  password: string,
  target: string,
  locale: { locationCode: number; languageCode: string },
) {
  const [labs, overview] = await Promise.all([
    fetchLabs({ login, password, target, ...locale }),
    fetchOverview({ login, password, target }),
  ])
  const rows = labs ? interpretLabs(labs.items).slice(0, 50) : []
  const parseRaté = labs !== null && labs.totalCount > 0 && rows.length === 0
  return {
    labsOk: labs !== null && !parseRaté,
    rows,
    counts: overview ? interpretOverview(overview) : null,
  }
}

export async function executerRefreshWeekly(ctx: ActionCtx): Promise<void> {
  const snapshot = await executerRefreshSiteSnapshot(ctx)
  if ("skipped" in snapshot && snapshot.skipped === "dfs_absent") return

  const [login, password] = await Promise.all([
    lireSecret(ctx, "DATAFORSEO_LOGIN"),
    lireSecret(ctx, "DATAFORSEO_PASSWORD"),
  ])
  if (!login || !password) return

  const settings = await ctx.runQuery(internal.seoRanks.settingsForSeo, {})
  const locale = resolveSerpLocale(settings)
  const origin = origineCibleStats({
    declaredDomain: settings.declaredDomain,
    webSiteUrl: process.env.WEB_SITE_URL,
  })

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
  await ctx.runMutation(internal.seoRanks.recordPositionHistory, {
    fetchedAt: Date.now(),
  })
}

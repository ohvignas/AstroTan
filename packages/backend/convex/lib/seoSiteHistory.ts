import type { MutationCtx } from "../_generated/server"

export const SEO_METRICS = ["position", "backlinks", "keywords"] as const
export type SeoMetric = (typeof SEO_METRICS)[number]

export type RelevePoint = { fetchedAt: number; value: number }

export type HistoryRow = { metric: SeoMetric; fetchedAt: number; value: number }

export type SiteSeries = {
  position: RelevePoint[]
  backlinks: RelevePoint[]
  keywords: RelevePoint[]
}

export function filtrerReleves(
  points: RelevePoint[],
  startAt: number,
  endAt: number,
): RelevePoint[] {
  return points
    .filter((p) => p.fetchedAt >= startAt && p.fetchedAt <= endAt)
    .sort((a, b) => a.fetchedAt - b.fetchedAt)
}

function seriePour(
  metric: SeoMetric,
  history: HistoryRow[],
  fallback: RelevePoint | undefined,
  startAt: number,
  endAt: number,
): RelevePoint[] {
  const fromHistory = filtrerReleves(
    history
      .filter((row) => row.metric === metric)
      .map(({ fetchedAt, value }) => ({ fetchedAt, value })),
    startAt,
    endAt,
  )
  if (fromHistory.length > 0) return fromHistory
  if (!fallback) return []
  return filtrerReleves([fallback], startAt, endAt)
}

/**
 * Les points à tracer : uniquement des relevés, jamais un seau inventé
 * entre deux lundis. Sans historique, le snapshot courant tient lieu
 * d'unique point — s'il tombe dans la fenêtre.
 */
export function assemblerSeries(input: {
  history: HistoryRow[]
  fallback: Partial<Record<SeoMetric, RelevePoint>>
  startAt: number
  endAt: number
}): SiteSeries {
  const { history, fallback, startAt, endAt } = input
  return {
    position: seriePour("position", history, fallback.position, startAt, endAt),
    backlinks: seriePour("backlinks", history, fallback.backlinks, startAt, endAt),
    keywords: seriePour("keywords", history, fallback.keywords, startAt, endAt),
  }
}

export async function insererReleve(
  ctx: MutationCtx,
  metric: SeoMetric,
  value: number,
  fetchedAt: number,
) {
  await ctx.db.insert("seoSiteHistory", { metric, value, fetchedAt })
}

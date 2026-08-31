export type SiteKeyword = { keyword: string; position: number; url: string }

export type SiteSnapshot = {
  configured: boolean
  declaredDomain: string | null
  averagePosition: number | null
  averagePositionPrev: number | null
  backlinks: {
    value: number
    prev: number | null
    fetchedAt: number
  } | null
  referringDomains: { value: number; prev: number | null } | null
  keywords: { keyword: string; position: number }[]
  rankingPages: { path: string; position: number }[]
}

function pathOf(url: string, host: string): string | null {
  try {
    const parsed = new URL(url)
    const hote = parsed.hostname.replace(/^www\./, "").toLowerCase()
    if (hote !== host.replace(/^www\./, "").toLowerCase()) return null
    const path = parsed.pathname || "/"
    return path.length > 1 ? path.replace(/\/+$/, "") : "/"
  } catch {
    return null
  }
}

export function assembleSiteSnapshot(input: {
  configured: boolean
  declaredDomain: string | null
  rankedPositions: { position: number; previousPosition?: number }[]
  keywords: SiteKeyword[]
  backlinks: {
    backlinks: number
    referringDomains: number
    backlinksPrev?: number
    referringDomainsPrev?: number
    fetchedAt: number
  } | null
}): SiteSnapshot {
  const ranked = input.rankedPositions
  const withPrev = ranked.filter((r) => r.previousPosition !== undefined)
  const average = (values: number[]) =>
    values.length === 0
      ? null
      : values.reduce((sum, n) => sum + n, 0) / values.length

  const keywords = [...input.keywords]
    .sort((a, b) => a.position - b.position)
    .slice(0, 5)
    .map(({ keyword, position }) => ({ keyword, position }))

  const host = input.declaredDomain
  const bestByPath = new Map<string, number>()
  if (host) {
    for (const row of input.keywords) {
      const path = pathOf(row.url, host)
      if (path === null) continue
      const current = bestByPath.get(path)
      if (current === undefined || row.position < current) {
        bestByPath.set(path, row.position)
      }
    }
  }
  const rankingPages = [...bestByPath.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, 5)
    .map(([path, position]) => ({ path, position }))

  return {
    configured: input.configured,
    declaredDomain: input.declaredDomain,
    averagePosition: average(ranked.map((r) => r.position)),
    averagePositionPrev: average(withPrev.map((r) => r.previousPosition as number)),
    backlinks: input.backlinks
      ? {
          value: input.backlinks.backlinks,
          prev: input.backlinks.backlinksPrev ?? null,
          fetchedAt: input.backlinks.fetchedAt,
        }
      : null,
    referringDomains: input.backlinks
      ? {
          value: input.backlinks.referringDomains,
          prev: input.backlinks.referringDomainsPrev ?? null,
        }
      : null,
    keywords,
    rankingPages,
  }
}

export const DATAFORSEO_SERP_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/live/advanced"
export const DATAFORSEO_LABS_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live"
export const DATAFORSEO_BACKLINKS_URL =
  "https://api.dataforseo.com/v3/backlinks/overview/live"
export const DATAFORSEO_SERP_TIMEOUT_MS = 30_000
export const SERP_DEPTH = 100

export type SerpVerdict =
  | { status: "ranked"; position: number }
  | { status: "other_url"; rankedUrl: string }
  | { status: "out_of_top_100" }

export function normalizeHostPath(url: string): { host: string; path: string } {
  const parsed = new URL(url)
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase()
  let path = parsed.pathname || "/"
  if (path.length > 1) path = path.replace(/\/+$/, "")
  return { host, path }
}

export function matchValue(host: string, publicPath: string): string {
  const hote = host.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase()
  return `${hote}${publicPath}`
}

function sameTarget(
  candidate: string,
  targetUrl: string,
  ourHost: string,
): "exact" | "host" | "other" {
  let parsed: { host: string; path: string }
  try {
    parsed = normalizeHostPath(candidate)
  } catch {
    return "other"
  }
  const target = normalizeHostPath(targetUrl)
  const host = ourHost.replace(/^www\./, "").toLowerCase()
  if (parsed.host === target.host && parsed.path === target.path) return "exact"
  if (parsed.host === host) return "host"
  return "other"
}

export function interpretOrganic(args: {
  items: unknown[]
  targetUrl: string
  ourHost: string
}): SerpVerdict {
  let otherUrl: string | undefined
  for (const raw of args.items) {
    const item = raw as { type?: unknown; url?: unknown; rank_absolute?: unknown }
    if (item.type !== "organic" || typeof item.url !== "string") continue
    const kind = sameTarget(item.url, args.targetUrl, args.ourHost)
    if (kind === "exact") {
      const position =
        typeof item.rank_absolute === "number" ? item.rank_absolute : undefined
      if (position === undefined) continue
      return { status: "ranked", position }
    }
    if (kind === "host" && otherUrl === undefined) otherUrl = item.url
  }
  if (otherUrl !== undefined) return { status: "other_url", rankedUrl: otherUrl }
  return { status: "out_of_top_100" }
}

export function interpretLabs(items: unknown[]): {
  keyword: string
  position: number
  url: string
}[] {
  const rows: { keyword: string; position: number; url: string }[] = []
  for (const raw of items) {
    const item = raw as {
      keyword_data?: { keyword?: unknown }
      keyword?: unknown
      ranked_serp_element?: {
        serp_item?: {
          rank_absolute?: unknown
          rank_group?: unknown
          url?: unknown
        }
      }
    }
    const keyword =
      (typeof item.keyword_data?.keyword === "string" && item.keyword_data.keyword) ||
      (typeof item.keyword === "string" ? item.keyword : "")
    const serp = item.ranked_serp_element?.serp_item
    const url = typeof serp?.url === "string" ? serp.url : ""
    const position =
      typeof serp?.rank_absolute === "number"
        ? serp.rank_absolute
        : typeof serp?.rank_group === "number"
          ? serp.rank_group
          : undefined
    if (!keyword || !url || position === undefined) continue
    rows.push({ keyword, position, url })
  }
  return rows
}

export function interpretOverview(body: unknown): {
  backlinks: number
  referringDomains: number
} | null {
  const tasks = (body as { tasks?: { result?: unknown[] }[] } | null)?.tasks
  const first = tasks?.[0]?.result?.[0] as
    | { backlinks?: unknown; referring_domains?: unknown }
    | undefined
  if (
    first === undefined ||
    typeof first.backlinks !== "number" ||
    typeof first.referring_domains !== "number"
  ) {
    return null
  }
  return { backlinks: first.backlinks, referringDomains: first.referring_domains }
}

import type { AnalyticsResult } from "@astrotan/backend/convex/analytics"
import type { DocumentRank } from "@astrotan/backend/convex/lib/seoRankState"
import type { SiteSnapshot } from "@astrotan/backend/convex/lib/seoSnapshot"

export type FactLine = { id: "rank" | "umami" | "labs"; text: string }

export function factsForPost(input: {
  path: string
  targetKeyword: string
  rank: DocumentRank | undefined
  umami: AnalyticsResult | undefined
  snapshot: SiteSnapshot | undefined
}): FactLine[] {
  return [
    { id: "rank", text: rankFact(input.rank) },
    { id: "umami", text: umamiFact(input.umami) },
    {
      id: "labs",
      text: labsFact(input.snapshot, input.targetKeyword, input.path),
    },
  ]
}

function rankFact(rank: DocumentRank | undefined): string {
  if (rank === undefined) return "Rang : chargement…"
  if (rank.state === "ranked") return `Rang relevé : ${rank.position}.`
  if (rank.state === "no_keyword") return "Rang : aucun mot-clé cible."
  if (rank.state === "dfs_absent") return "Rang : DataForSEO n’est pas configuré."
  if (rank.state === "never_ranked") return "Rang : jamais relevé."
  if (rank.state === "out_of_top_100") return "Rang : hors du top 100."
  if (rank.state === "keyword_changed") {
    return `Rang : le dernier relevé porte encore « ${rank.previousKeyword} ».`
  }
  return `Rang : une autre URL ranke.`
}

function umamiFact(umami: AnalyticsResult | undefined): string {
  if (umami === undefined) return "Audience : chargement…"
  if (umami.status !== "ok" || umami.last7 === null) {
    return "Audience : pas de mesure Umami sur ce chemin."
  }
  return `Audience : ${umami.last7.pageviews} vues sur 7 jours.`
}

function labsFact(
  snapshot: SiteSnapshot | undefined,
  keyword: string,
  path: string,
): string {
  if (snapshot === undefined) return "Labs : chargement…"
  if (!snapshot.configured) return "Labs : DataForSEO n’est pas configuré."
  const key = keyword.trim().toLowerCase()
  const byKeyword = snapshot.keywords.find((k) => k.keyword.toLowerCase() === key)
  if (byKeyword) return `Labs : « ${byKeyword.keyword} » est ${byKeyword.position}e (snapshot site).`
  const byPath = snapshot.rankingPages.find((p) => p.path === path)
  if (byPath) return `Labs : ce chemin est ${byPath.position}e sur le snapshot site.`
  return "Labs : ce mot-clé ou ce chemin n’est pas dans le snapshot."
}

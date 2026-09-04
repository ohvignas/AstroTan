import { RELEVER_THROTTLE_MS } from "@astrotan/backend/convex/lib/seoRankState"
import type { DocumentRank } from "@astrotan/backend/convex/lib/seoRankState"
import type { Periode, SiteSummary } from "@astrotan/backend/convex/analytics"

export const CYCLE_MS = 800

export const MOTS_RELEVE = ["Recherche", "Analyse", "Positions"] as const
export const MOTS_AUDIENCE = ["Mesure", "Audience", "Visites"] as const

const JOUR_MS = 24 * 60 * 60 * 1000

export function formatRefreshAt(at: number, now = Date.now()): string {
  const delta = Math.max(0, now - at)
  if (delta < JOUR_MS) return relatif(delta)
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
  }).format(new Date(at))
}

function relatif(delta: number): string {
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  return `il y a ${Math.round(delta / 3_600_000)} h`
}

export function motEnCours(
  words: readonly string[],
  elapsedMs: number,
  cycleMs = CYCLE_MS,
): string {
  if (words.length === 0) return ""
  return words[Math.floor(elapsedMs / cycleMs) % words.length] ?? ""
}

export function estThrottleReleve(
  rank: DocumentRank | undefined,
  now = Date.now(),
): boolean {
  if (rank?.fetchedAt === undefined) return false
  return now - rank.fetchedAt < RELEVER_THROTTLE_MS
}

export function raisonReleveInactif(
  rank: DocumentRank | undefined,
  now = Date.now(),
): string | undefined {
  if (!rank || rank.canRelever) return undefined
  if (rank.state === "no_keyword") return "Aucun mot-clé cible."
  if (rank.state === "dfs_absent") return "DataForSEO n'est pas configuré."
  if (estThrottleReleve(rank, now)) {
    return "Déjà relevé il y a moins d'une heure."
  }
  return "Publiez d'abord pour relever."
}

export {
  cibleApex,
  doitEssayerJumeau,
  estOrigineLocale,
  hoteJumeauWww,
  origineCibleRefresh,
  origineCibleStats,
  snapshotStatsVide,
} from "@astrotan/backend/convex/lib/refreshCible"

export function dateDonneesAffichees(input: {
  umamiFetchedAt?: number | null
  seoFetchedAt?: number | null
}): number | undefined {
  const times = [input.umamiFetchedAt, input.seoFetchedAt].filter(
    (t): t is number => typeof t === "number",
  )
  if (times.length === 0) return undefined
  return Math.max(...times)
}

export function messageRefreshEchec(
  kind: "umami" | "seo" | "seo-keywords" | "seo-backlinks" | "site" | "reseau",
  origin?: string | null,
): string {
  if (kind === "umami") return "Le service d'audience n'a pas répondu."
  if (kind === "seo") return "Le relevé des positions n'a pas abouti."
  if (kind === "seo-keywords") return "Le relevé des mots-clés n'a pas abouti."
  if (kind === "seo-backlinks") return "Le relevé des backlinks n'a pas abouti."
  if (kind === "site") {
    const ou = origin ? ` (${origin.replace(/^https?:\/\//, "")})` : ""
    return `Le site public n'est pas joignable${ou}.`
  }
  return "La mise à jour a échoué. Réessayez."
}

export function summaryInjoignable(periode: Periode): SiteSummary {
  return {
    periode,
    unit: "day",
    startAt: 0,
    endAt: 0,
    totals: null,
    series: null,
    topPages: null,
    topReferrers: null,
    status: "unreachable",
    fetchedAt: null,
  }
}

export type RefreshSiteOutcome =
  | { ok: true; fetchedAt?: number; skipped?: "dfs_absent" | "no_domain" }
  | { ok: false; reason: "unreachable" | "keywords" | "backlinks" }

/**
 * Recharger : vrai appel Umami, relevé DataForSEO du snapshot site
 * (si les clés sont là), puis invalidation du cache HTML.
 */
export async function executerRefresh(input: {
  periode: Periode
  chargerAudience: () => Promise<SiteSummary>
  releverSite?: () => Promise<RefreshSiteOutcome>
  invaliderSite?: () => Promise<{ ok: boolean; origin?: string | null }>
}): Promise<{ summary: SiteSummary; error: string | null }> {
  const siteP =
    input.invaliderSite?.().catch(() => ({ ok: false as const, origin: null })) ??
    Promise.resolve({ ok: true as const })
  const seoP =
    input.releverSite?.().catch(() => ({
      ok: false as const,
      reason: "unreachable" as const,
    })) ?? Promise.resolve({ ok: true as const, skipped: "dfs_absent" as const })
  try {
    const [summary, seo, site] = await Promise.all([
      input.chargerAudience(),
      seoP,
      siteP,
    ])
    if (summary.status === "unreachable" || summary.status === "unauthorized") {
      return { summary, error: messageRefreshEchec("umami") }
    }
    if (seo.ok === false) {
      if (seo.reason === "keywords") {
        return { summary, error: messageRefreshEchec("seo-keywords") }
      }
      if (seo.reason === "backlinks") {
        return { summary, error: messageRefreshEchec("seo-backlinks") }
      }
      return { summary, error: messageRefreshEchec("seo") }
    }
    if (site.ok === false) {
      return { summary, error: messageRefreshEchec("site", site.origin) }
    }
    return { summary, error: null }
  } catch {
    return {
      summary: summaryInjoignable(input.periode),
      error: messageRefreshEchec("reseau"),
    }
  }
}

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { AnalyticsResult } from "@astrotan/backend/convex/analytics"
import type { DocumentRank } from "@astrotan/backend/convex/lib/seoRankState"
import { AnalyticsPanel } from "./analytics-panel"

const OK: AnalyticsResult = {
  last7: { pageviews: 128, visitors: 44, pageviewsPrev: 100, visitorsPrev: 40 },
  last30: { pageviews: 903, visitors: 310, pageviewsPrev: 800, visitorsPrev: 280 },
  status: "ok",
}

const RANKED: DocumentRank = {
  state: "ranked",
  position: 7,
  previousPosition: 12,
  gap: 5,
  canRelever: true,
}

function render(
  result: AnalyticsResult | undefined,
  rank: DocumentRank | undefined = RANKED,
) {
  return renderToStaticMarkup(<AnalyticsPanel result={result} rank={rank} />)
}

describe("AnalyticsPanel", () => {
  test("pendant le chargement Umami, ne montre aucun chiffre d'audience", () => {
    const html = render(undefined)
    expect(html).toContain("Chargement")
    expect(html).not.toContain("128")
  })

  test("quatre indicateurs quand la mesure et le rang sont là", () => {
    const html = render(OK)
    expect(html).toContain("Vues 7 j")
    expect(html).toContain("128")
    expect(html).toContain("Visiteurs 30 j")
    expect(html).toContain("310")
    expect(html).toContain("Position")
    expect(html).toContain("7")
    expect(html).toContain("Écart vs sem. préc.")
    expect(html).toContain("5")
    expect(html).toContain("sm:grid-cols-4")
  })

  test("une page sans visite affiche zéro — zéro est une mesure", () => {
    const html = render({
      last7: { pageviews: 0, visitors: 0, pageviewsPrev: 0, visitorsPrev: 0 },
      last30: { pageviews: 0, visitors: 0, pageviewsPrev: 0, visitorsPrev: 0 },
      status: "ok",
    })
    expect(html).toContain(">0<")
    expect(html).toContain("Vues 7 j")
    expect(html).not.toContain("injoignable")
  })

  test.each([
    ["not-configured", "configurée"],
    ["unreachable", "injoignable"],
    ["unauthorized", "refusés"],
  ] as const)(
    "l'état %s explique l'absence de chiffres plutôt que d'afficher zéro",
    (status, expected) => {
      const html = render({ last7: null, last30: null, status })
      expect(html).toContain(expected)
      expect(html).not.toContain(">0<")
    },
  )

  test.each([
    [{ state: "no_keyword", canRelever: false } as DocumentRank, "Aucun mot-clé"],
    [{ state: "never_ranked", canRelever: true } as DocumentRank, "Jamais relevé"],
    [{ state: "out_of_top_100", canRelever: true } as DocumentRank, "Hors du top 100"],
    [
      { state: "other_url", rankedUrl: "https://exemple.fr/autre", canRelever: true } as DocumentRank,
      "Une autre URL ranke",
    ],
    [
      {
        state: "keyword_changed",
        previousKeyword: "agence",
        canRelever: true,
      } as DocumentRank,
      "agence",
    ],
    [{ state: "dfs_absent", canRelever: false } as DocumentRank, "settings/mesure"],
  ])("l'état de rang %j affiche sa phrase", (rank, expected) => {
    const html = render(OK, rank)
    expect(html).toContain(expected)
  })

  test("Relever est inactif sans mot-clé ou sans DataForSEO", () => {
    for (const rank of [
      { state: "no_keyword", canRelever: false } as DocumentRank,
      { state: "dfs_absent", canRelever: false } as DocumentRank,
    ]) {
      const html = render(OK, rank)
      expect(html).toContain("Relever")
      expect(html).toMatch(/disabled/)
    }
  })

  test("Relever est actif quand canRelever", () => {
    const html = render(OK, RANKED)
    expect(html).toContain("Relever")
    expect(html).not.toMatch(/disabled=""/)
  })
})

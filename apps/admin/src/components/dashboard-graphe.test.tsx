import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { SiteSummary } from "@astrotan/backend/convex/analytics"
import type { SiteSnapshot } from "@astrotan/backend/convex/lib/seoSnapshot"
import type { SiteSeries } from "@astrotan/backend/convex/lib/seoSiteHistory"
import { DashboardGraphe } from "./dashboard-graphe"

const OK: SiteSummary = {
  periode: "mois",
  unit: "day",
  startAt: 1_787_000_000_000,
  endAt: 1_789_000_000_000,
  totals: {
    visitors: { value: 44, prev: 39 },
    pageviews: { value: 128, prev: 160 },
  },
  series: [
    { date: "2026-08-01T00:00:00Z", visitors: 5, pageviews: 12 },
    { date: "2026-08-02T00:00:00Z", visitors: 9, pageviews: 20 },
  ],
  topPages: [],
  topReferrers: [],
  status: "ok",
  fetchedAt: 1_787_000_000_000,
}

const SNAPSHOT: SiteSnapshot = {
  configured: true,
  declaredDomain: "exemple.fr",
  averagePosition: 8,
  averagePositionPrev: 11,
  backlinks: { value: 42, prev: 30, fetchedAt: 1 },
  referringDomains: { value: 12, prev: 10 },
  keywords: [],
  rankingPages: [],
  keywordCount: 18,
  fetchedAt: 1,
}

const HISTORY: SiteSeries = {
  position: [
    { fetchedAt: Date.UTC(2026, 7, 3, 6, 0, 0), value: 11 },
    { fetchedAt: Date.UTC(2026, 7, 10, 6, 0, 0), value: 8 },
  ],
  backlinks: [{ fetchedAt: Date.UTC(2026, 7, 10, 6, 0, 0), value: 42 }],
  keywords: [{ fetchedAt: Date.UTC(2026, 7, 10, 6, 0, 0), value: 18 }],
}

function render(
  serie: "visites" | "position" | "backlinks" | "keywords",
  history: SiteSeries = HISTORY,
) {
  return renderToStaticMarkup(
    <DashboardGraphe
      summary={OK}
      periode="mois"
      snapshot={SNAPSHOT}
      history={history}
      serie={serie}
      onSerie={() => {}}
    />,
  )
}

describe("DashboardGraphe", () => {
  test("visites par défaut : courbes Umami, titre Visites pressé", () => {
    const html = render("visites")
    expect(html).toContain("--color-pageviews")
    expect(html).toContain("--color-visitors")
    expect(html).not.toContain("--color-rank")
    expect(html).toContain(">Visites<")
    expect(html).toContain('data-etat="mesure"')
  })

  test("clic Position moyenne : série de rang, plus les visites", () => {
    const html = render("position")
    expect(html).toContain("--color-rank")
    expect(html).not.toContain("--color-pageviews")
    expect(html).toContain("Position moyenne")
    expect(html).toContain('aria-pressed="true"')
  })

  test("un seul relevé : le cadre reste une mesure, un point, pas une courbe lisse", () => {
    const html = render("backlinks", {
      ...HISTORY,
      backlinks: [{ fetchedAt: Date.UTC(2026, 7, 10, 6, 0, 0), value: 42 }],
    })
    expect(html).toContain('data-etat="mesure"')
    expect(html).toContain("--color-backlinks")
    expect(html).toContain('data-points="1"')
    expect(html).not.toContain('type="monotone"')
  })

  test("titre Visites reste un bouton pour y revenir", () => {
    const html = render("keywords")
    expect(html).toMatch(/<button[^>]*>Visites<\/button>/)
    expect(html).toContain("--color-keywords")
  })
})

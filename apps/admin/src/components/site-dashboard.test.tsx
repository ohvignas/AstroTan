// Ce que ce tableau de bord peut afficher de faux est plus grave que ce
// qu'il peut afficher de laid : un zéro là où le service est en panne, une
// courbe à l'envers, un « +100 % » calculé depuis rien.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { SiteSummary, UmamiLinks } from "@astrotan/backend/convex/analytics"
import { SiteDashboard, trend } from "./site-dashboard"

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
  topPages: [{ label: "/blog/bienvenue", visits: 312 }],
  topReferrers: [{ label: "Accès direct", visits: 94 }],
  status: "ok",
}

const SHARED: UmamiLinks = {
  dashboard: "https://umami.illith.test/share/demo",
  shared: true,
}

function render(summary: SiteSummary | undefined, umami: UmamiLinks | null = null) {
  return renderToStaticMarkup(
    <SiteDashboard summary={summary} umami={umami} periode="mois" onPeriode={() => {}} />
  )
}

describe("trend", () => {
  test("rend l'écart en pourcentage, dans les deux sens", () => {
    expect(trend({ value: 44, prev: 39 })).toBe(13)
    expect(trend({ value: 128, prev: 160 })).toBe(-20)
  })

  test("refuse de qualifier une progression depuis zéro", () => {
    // « +100 % » depuis rien est une division par zéro déguisée : aucun
    // pourcentage ne décrit honnêtement ce passage.
    expect(trend({ value: 12, prev: 0 })).toBeNull()
  })
})

// Les tests de la courbe ont disparu avec la sparkline écrite à la main.
// Le graphique est désormais rendu par recharts, qui exige un DOM là où la
// configuration vitest de cette application est en `environment: "node"`.
// Ce qui restait vérifiable sans DOM — le format des étiquettes, la lecture
// des seaux en UTC — a été déplacé dans `lib/dashboardFormat.test.ts`
// plutôt que supprimé.

describe("SiteDashboard", () => {
  test("affiche chiffres, tendances et palmarès", () => {
    const html = render(OK, SHARED)
    expect(html).toContain("44")
    expect(html).toContain("13 % vs")
    expect(html).toContain("/blog/bienvenue")
    expect(html).toContain("Accès direct")
  })

  test("avec un partage, un seul lien, vers le partage", () => {
    const html = render(OK, SHARED)
    expect(html).toContain("/share/demo")
    expect(html).toContain("Tout le détail")
    // Le second lien « Administrer Umami » a été retiré : régler Umami se
    // fait depuis Umami, et il occupait une place à côté du seul lien qui
    // rend un service.
    expect(html).not.toContain("Administrer")
  })

  test("sans partage, le lien mène à la racine et le dit", () => {
    const html = render(OK, {
      dashboard: "https://umami.illith.test",
      shared: false,
    })
    expect(html).toContain("Ouvrir Umami")
    expect(html).not.toContain("Administrer")
  })

  test("sans Umami configuré, aucun lien mort", () => {
    const html = render(OK, null)
    expect(html).not.toContain("umami.illith.test")
  })

  test.each([
    ["not-configured", "configurée"],
    ["unreachable", "injoignable"],
    ["unauthorized", "refusés"],
  ] as const)("l'état %s explique au lieu d'afficher zéro", (status, expected) => {
    const html = render({
      periode: "mois",
      unit: "day",
      startAt: 0,
      endAt: 0,
      totals: null,
      series: null,
      topPages: null,
      topReferrers: null,
      status,
    })
    expect(html).toContain(expected)
    expect(html).not.toContain(">0<")
  })

  test("un palmarès indisponible ne se confond pas avec un palmarès vide", () => {
    const html = render({ ...OK, topReferrers: null })
    expect(html).toContain("indisponible")
    // Les chiffres principaux, eux, sont toujours là.
    expect(html).toContain("44")
  })
})

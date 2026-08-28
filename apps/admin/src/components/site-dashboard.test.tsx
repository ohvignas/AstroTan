// Ce que ce tableau de bord peut afficher de faux est plus grave que ce
// qu'il peut afficher de laid : un zéro là où le service est en panne, une
// courbe à l'envers, un « +100 % » calculé depuis rien.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { SiteSummary } from "@astrotan/backend/convex/analytics"
import { SiteDashboard, Sparkline, trend } from "./site-dashboard"

const OK: SiteSummary = {
  totals: {
    visitors: { value: 44, prev: 39 },
    pageviews: { value: 128, prev: 160 },
  },
  series: [
    { date: "2026-08-01T00:00:00Z", visitors: 5, pageviews: 12 },
    { date: "2026-08-02T00:00:00Z", visitors: 9, pageviews: 20 },
  ],
  topPages: [{ label: "/blog/bienvenue", views: 312 }],
  topReferrers: [{ label: "Accès direct", views: 94 }],
  status: "ok",
}

function render(summary: SiteSummary | undefined, umamiUrl: string | null = null) {
  return renderToStaticMarkup(
    <SiteDashboard summary={summary} umamiUrl={umamiUrl} />
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

describe("Sparkline", () => {
  test("dessine la courbe dans le bon sens", () => {
    const svg = renderToStaticMarkup(
      <Sparkline
        points={[
          { date: "a", visitors: 0, pageviews: 0 },
          { date: "b", visitors: 10, pageviews: 0 },
        ]}
      />
    )
    // L'origine SVG est en haut : la valeur haute doit produire un y BAS.
    // Sans la soustraction, la courbe s'affiche à l'envers — une erreur que
    // l'œil ne rattrape pas sur des données réelles.
    expect(svg).toContain("M0.0,80.0")
    expect(svg).toContain("L600.0,0.0")
  })

  test("un seul point ne fait pas une courbe", () => {
    const svg = renderToStaticMarkup(
      <Sparkline points={[{ date: "a", visitors: 3, pageviews: 3 }]} />
    )
    expect(svg).toBe("")
  })
})

describe("SiteDashboard", () => {
  test("affiche chiffres, tendances et palmarès", () => {
    const html = render(OK, "https://umami.illith.test")
    expect(html).toContain("44")
    expect(html).toContain("13 % vs")
    expect(html).toContain("/blog/bienvenue")
    expect(html).toContain("Accès direct")
    expect(html).toContain("Ouvrir Umami")
  })

  test("sans Umami configuré, aucun lien mort", () => {
    const html = render(OK, null)
    expect(html).not.toContain("Ouvrir Umami")
  })

  test.each([
    ["not-configured", "configurée"],
    ["unreachable", "injoignable"],
    ["unauthorized", "refusés"],
  ] as const)("l'état %s explique au lieu d'afficher zéro", (status, expected) => {
    const html = render({
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

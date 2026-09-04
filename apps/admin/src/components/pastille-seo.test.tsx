import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { SiteSnapshot } from "@astrotan/backend/convex/lib/seoSnapshot"
import { ColonnePastillesSeo, PastilleSeo } from "./pastille-seo"

const SNAPSHOT: SiteSnapshot = {
  configured: true,
  declaredDomain: "exemple.fr",
  averagePosition: 8,
  averagePositionPrev: 11,
  backlinks: { value: 42, prev: 30, fetchedAt: 1 },
  referringDomains: { value: 12, prev: 10 },
  keywords: [{ keyword: "agence web", position: 4 }],
  rankingPages: [{ path: "/", position: 4 }],
  keywordCount: 18,
  fetchedAt: 1,
}

describe("PastilleSeo", () => {
  test("sélectionnée : aria-pressed et fond actif", () => {
    const html = renderToStaticMarkup(
      <PastilleSeo
        label="Position moyenne"
        value={8}
        sens="up"
        pressed
        onSelect={() => {}}
      />,
    )
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain("bg-muted")
    expect(html).toContain("ring-")
    expect(html).toContain("<button")
  })

  test("non sélectionnée : aria-pressed false, pas de ring", () => {
    const html = renderToStaticMarkup(
      <PastilleSeo
        label="Backlinks"
        value={42}
        sens="up"
        pressed={false}
        onSelect={() => {}}
      />,
    )
    expect(html).toContain('aria-pressed="false"')
    expect(html).not.toContain("ring-")
  })
})

describe("ColonnePastillesSeo", () => {
  test("pastille Visites en tête, puis les trois SEO, une seule pressée", () => {
    const html = renderToStaticMarkup(
      <ColonnePastillesSeo
        snapshot={SNAPSHOT}
        serie="position"
        onSerie={() => {}}
        visitesValue={44}
      />,
    )
    const visites = html.indexOf("Visites")
    const position = html.indexOf("Position moyenne")
    const backlinks = html.indexOf("Backlinks")
    const mots = html.indexOf("Mots-clés")
    expect(visites).toBeGreaterThan(-1)
    expect(visites).toBeLessThan(position)
    expect(position).toBeLessThan(backlinks)
    expect(backlinks).toBeLessThan(mots)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toContain("44")
    expect(html).toContain("8")
    expect(html).toContain("42")
    expect(html).toContain("18")
  })

  test("jamais relevé : tiret, pas un faux zéro", () => {
    const html = renderToStaticMarkup(
      <ColonnePastillesSeo
        snapshot={{
          ...SNAPSHOT,
          averagePosition: null,
          backlinks: null,
          referringDomains: null,
          keywords: [],
          keywordCount: 0,
          fetchedAt: null,
        }}
      />,
    )
    expect(html).toContain("—")
    expect(html).not.toMatch(/>0</)
  })
})

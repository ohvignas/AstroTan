import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { SerpLieuSelect } from "./serp-lieu-select"

const inerte = {
  canWrite: true,
  serpLocationCode: null as number | null,
  serpLanguageCode: null as string | null,
  onSave: async () => {},
}

test("la liste curated est là, pas un catalogue mondial", () => {
  const html = renderToStaticMarkup(<SerpLieuSelect {...inerte} />)
  expect(html).toContain("France (Google)")
  expect(html).toContain("Belgique (Google)")
  expect(html).toContain("Suisse (Google)")
  expect(html).toContain("Luxembourg (Google)")
  expect(html).toContain("Canada (Google)")
  expect(html).toContain("Paris (Google)")
  expect(html).toContain("Lyon (Google)")
  expect(html).toContain("Marseille (Google)")
  expect(html).toContain("Toulouse (Google)")
  expect(html).toContain("Bordeaux (Google)")
  expect(html).toContain("Lille (Google)")
  expect(html).toContain("Nantes (Google)")
  expect(html).toContain("Nice (Google)")
  expect(html).not.toContain("États-Unis")
  expect(html).not.toContain("United States")
})

test("sans valeur persistée, France est sélectionnée", () => {
  const html = renderToStaticMarkup(<SerpLieuSelect {...inerte} />)
  expect(html).toContain('<option value="fr-2250" selected="">France (Google)</option>')
})

test("un code persisté est repris", () => {
  const html = renderToStaticMarkup(
    <SerpLieuSelect {...inerte} serpLocationCode={1006094} serpLanguageCode="fr" />,
  )
  expect(html).toContain('<option value="fr-1006094" selected="">Paris (Google)</option>')
  expect(html).toContain('data-location="1006094"')
})

test("un editor ne peut pas changer le lieu", () => {
  const html = renderToStaticMarkup(<SerpLieuSelect {...inerte} canWrite={false} />)
  const debut = html.indexOf('id="serp-lieu"')
  expect(debut).toBeGreaterThan(-1)
  const balise = html.slice(html.lastIndexOf("<select", debut), html.indexOf(">", debut))
  expect(balise).toMatch(/ disabled(=""|>)/)
})

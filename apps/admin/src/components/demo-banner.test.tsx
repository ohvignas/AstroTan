import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"

const useQuery = vi.fn()

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}))

vi.mock("convex/server", () => ({
  anyApi: { demo: { jeSuisDemo: "demo.jeSuisDemo" } },
}))

import { DemoBanner } from "./demo-banner"

test("masqué tant que la query n'a pas confirmé le compte démo", () => {
  useQuery.mockReturnValue(undefined)
  expect(renderToStaticMarkup(<DemoBanner />)).toBe("")
  useQuery.mockReturnValue(false)
  expect(renderToStaticMarkup(<DemoBanner />)).toBe("")
})

test("affiche l'avertissement français pour le compte démo", () => {
  useQuery.mockReturnValue(true)
  const html = renderToStaticMarkup(<DemoBanner />)
  expect(html).toContain("Bac à sable partagé")
  expect(html).toContain("effacés toutes les heures")
  expect(html).toMatch(/Rien n(&#x27;|')est publié sur le site/)
  expect(html).toContain('role="status"')
})

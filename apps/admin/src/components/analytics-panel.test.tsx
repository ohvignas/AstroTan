// Les états de ce panneau sont son intérêt : quatre d'entre eux disent
// pourquoi il n'y a pas de chiffres, et la seule faute grave serait de
// laisser croire à une page sans visiteurs quand le service est en panne.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { AnalyticsResult } from "@astrotan/backend/convex/analytics"
import { AnalyticsPanel } from "./analytics-panel"

function render(result: AnalyticsResult | undefined) {
  return renderToStaticMarkup(<AnalyticsPanel result={result} />)
}

describe("AnalyticsPanel", () => {
  test("pendant le chargement, ne montre aucun chiffre", () => {
    const html = render(undefined)
    expect(html).toContain("Chargement")
    expect(html).not.toContain("vues")
  })

  test("affiche les deux fenêtres quand la mesure a répondu", () => {
    const html = render({
      last7: { pageviews: 128, visitors: 44 },
      last30: { pageviews: 903, visitors: 310 },
      status: "ok",
    })
    expect(html).toContain("7 derniers jours")
    expect(html).toContain("128")
    expect(html).toContain("30 derniers jours")
    expect(html).toContain("903")
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
      // Un zéro affiché serait lu comme « personne n'est venu » — une
      // information fausse dont l'auteur pourrait tirer une conclusion.
      expect(html).not.toContain(">0<")
    }
  )
})

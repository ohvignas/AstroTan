import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { DEFAULT_OPENROUTER_MODEL, OPENROUTER_MODELS } from "@astrotan/backend/convex/lib/openRouterModels"
import { AiModelSelect } from "./ai-model-select"
import source from "./ai-model-select.tsx?raw"

function render(
  patch: Partial<{
    canWrite: boolean
    openRouterModel: string | null
  }> = {},
) {
  return renderToStaticMarkup(
    <AiModelSelect
      canWrite={patch.canWrite ?? true}
      openRouterModel={patch.openRouterModel ?? null}
      onSave={async () => {}}
    />,
  )
}

test("porte le label Modèle et le texte d'aide", () => {
  const html = render()
  expect(html).toContain("Modèle de texte")
  expect(html).not.toMatch(/Chat de l(?:'|&#x27;)agent/)
  expect(html).toMatch(/SEO, GEO/)
  expect(html).not.toContain("<h1")
})

test("liste les libellés, pas seulement les ids", () => {
  const html = render()
  expect(html).toContain("Gemini 3.7 Flash — défaut")
  expect(html).toContain(DEFAULT_OPENROUTER_MODEL)
  // Le contenu du menu n'est pas dans le HTML statique (Select fermé).
  // La liste officielle est bien celle rendue : le composant n'en invente pas.
  expect(source).toContain("OPENROUTER_MODELS")
  expect(OPENROUTER_MODELS.some((m) => m.label.includes("Claude Opus 5"))).toBe(
    true,
  )
})

test("un editor voit le sélecteur, inerte", () => {
  const html = render({ canWrite: false })
  expect(html).toContain("Modèle de texte")
  expect(html).toMatch(/disabled/)
})

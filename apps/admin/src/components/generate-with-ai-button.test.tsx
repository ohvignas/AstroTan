import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { SparklesIcon } from "lucide-react"
import { GenerateWithAiButton } from "./generate-with-ai-button"

function render(props: { disabled?: boolean; busy?: boolean } = {}) {
  return renderToStaticMarkup(
    <GenerateWithAiButton
      disabled={props.disabled ?? false}
      busy={props.busy ?? false}
      busyLabel="Génération…"
      icon={<SparklesIcon data-icon="inline-start" />}
      placeholder="Ex. tutoiement"
      onGenerate={() => undefined}
    />,
  )
}

test("un seul groupe, pas deux pilules séparées", () => {
  const html = render()
  expect(html).toContain('role="group"')
  expect(html).toContain("overflow-hidden")
  expect(html).toContain("rounded-r-none")
  expect(html).toContain("rounded-l-none")
  expect(html).toContain("bg-primary")
  expect(html).not.toContain('data-slot="button-group"')
  expect(html).not.toContain("h-11")
  expect(html).not.toContain("min-h-11")
  expect(html).toContain("h-7")
})

test("le chevron est un segment du même bouton", () => {
  const html = render()
  expect(html).toContain("aria-haspopup")
  expect(html).toContain("Ajouter une instruction complémentaire")
  expect(html).toContain("Générer avec l’IA")
})

test("pendant l'appel, les deux segments sont désactivés et le spinner est à gauche", () => {
  const html = render({ busy: true })
  expect(html).toContain("Génération…")
  expect(html).toContain("animate-spin")
  expect(html).toContain("disabled")
  expect(html).not.toMatch(/>Générer avec l’IA</)
  expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(2)
})

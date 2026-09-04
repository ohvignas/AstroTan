import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { GenerateHintPanel } from "./generate-hint-panel"

test("le panneau a un libellé, un placeholder et le bouton Générer", () => {
  const html = renderToStaticMarkup(
    <GenerateHintPanel
      placeholder="Ex. style plat, pas de texte sur l'image"
      disabled={false}
      busy={false}
      onGenerate={() => undefined}
    />,
  )
  expect(html).toContain("Instruction complémentaire")
  expect(html).toContain("Ex. style plat, pas de texte sur l&#x27;image")
  expect(html).toContain("Générer")
  expect(html).toContain("maxLength=\"500\"")
})

test("pendant l'appel, le bouton du panneau est désactivé", () => {
  const html = renderToStaticMarkup(
    <GenerateHintPanel
      placeholder="Ex."
      disabled={false}
      busy
      onGenerate={() => undefined}
    />,
  )
  expect(html).toContain("disabled")
})

import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { GenerateCoverButton } from "./generate-cover-button"

test("affiche le libellé français", () => {
  const html = renderToStaticMarkup(
    <GenerateCoverButton disabled={false} busy={false} onGenerate={() => undefined} />,
  )
  expect(html).toContain("Générer avec l’IA")
})

test("le chevron ouvre un menu d'instruction", () => {
  const html = renderToStaticMarkup(
    <GenerateCoverButton disabled={false} busy={false} onGenerate={() => undefined} />,
  )
  expect(html).toContain("aria-haspopup")
  expect(html).toContain("Ajouter une instruction complémentaire")
})

test("pendant l'appel, dit qu'il génère", () => {
  const html = renderToStaticMarkup(
    <GenerateCoverButton disabled={false} busy={true} onGenerate={() => undefined} />,
  )
  expect(html).toContain("Génération de l’image…")
  expect(html).toContain("disabled")
})

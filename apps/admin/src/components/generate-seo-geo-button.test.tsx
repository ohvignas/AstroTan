import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { GenerateSeoGeoButton } from "./generate-seo-geo-button"

function render(props: { disabled?: boolean; busy?: boolean } = {}) {
  return renderToStaticMarkup(
    <GenerateSeoGeoButton
      disabled={props.disabled ?? false}
      busy={props.busy ?? false}
      onGenerate={() => undefined}
    />,
  )
}

describe("GenerateSeoGeoButton", () => {
  test("affiche le libellé français", () => {
    expect(render()).toContain("Générer avec l’IA")
  })

  test("le chevron ouvre un menu d'instruction", () => {
    const html = render()
    expect(html).toContain("aria-haspopup")
    expect(html).toContain("Ajouter une instruction complémentaire")
  })

  test("pendant l'appel, dit qu'il génère plutôt que de rester cliquable", () => {
    const html = render({ busy: true })
    expect(html).toContain("Génération…")
    expect(html).toContain("disabled")
    expect(html).not.toMatch(/>Générer avec l’IA</)
  })

  test("désactivé en lecture seule", () => {
    expect(render({ disabled: true })).toContain("disabled")
  })
})

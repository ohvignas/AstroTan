import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { Indicateur } from "./indicateur"

test("affiche le libellé, le chiffre en tabular-nums, et la flèche", () => {
  const html = renderToStaticMarkup(
    <Indicateur label="Vues 7 j" value={128} sens="up" />,
  )
  expect(html).toContain("Vues 7 j")
  expect(html).toContain("128")
  expect(html).toContain("tabular-nums")
  expect(html).toContain("↑")
})

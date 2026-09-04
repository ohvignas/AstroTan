import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { CoverPreview } from "./cover-preview"

test("l'aperçu est un rectangle 16:9, pas une pastille carrée", () => {
  const html = renderToStaticMarkup(
    <CoverPreview
      url="https://cdn.example/une.png"
      alt="Vitrine rénovée"
      title="Rénover une vitrine"
    />,
  )
  expect(html).toContain("aspect-video")
  expect(html).toContain("max-w-xl")
  expect(html).toContain("object-cover")
  expect(html).not.toContain("size-20")
  expect(html).toMatch(/Voir l(&#x27;|')image en entier/)
  expect(html).toContain("https://cdn.example/une.png")
  expect(html).toContain("Vitrine rénovée")
})

test("l'aperçu compact est plus étroit", () => {
  const html = renderToStaticMarkup(
    <CoverPreview
      url="https://cdn.example/une.png"
      alt="Vitrine rénovée"
      compact
    />,
  )
  expect(html).toContain("max-w-md")
  expect(html).not.toContain("max-w-sm")
  expect(html).not.toContain("max-w-xl")
})

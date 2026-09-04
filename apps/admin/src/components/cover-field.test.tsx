import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"

const storageId = "k17333storageid000000000000" as Id<"_storage">

vi.mock("convex/react", () => ({
  useQuery: () => [
    {
      _id: "m1",
      storageId,
      url: "https://example.test/cover.png",
      alt: "Vitrine rénovée",
      title: "Rénover une vitrine",
      filename: "une.png",
    },
  ],
  useMutation: () => async () => undefined,
}))

vi.mock("@/components/media-picker", () => ({
  MediaPicker: () => null,
}))

import { CoverField } from "./cover-field"

test("l'aperçu chargé n'est plus une pastille carrée", () => {
  const html = renderToStaticMarkup(
    <CoverField
      value={"kg123" as never}
      disabled={false}
      generating={false}
      onChange={() => undefined}
      onGenerate={() => undefined}
    />,
  )
  expect(html).toContain("aspect-video")
  expect(html).toContain("max-w-xl")
  expect(html).not.toContain("size-20")
})

test("rend GenerateCoverButton — plus de ReferenceError", () => {
  const html = renderToStaticMarkup(
    <CoverField
      value={null}
      disabled={false}
      generating={false}
      onChange={() => undefined}
      onGenerate={() => undefined}
    />,
  )
  expect(html).toContain("Générer avec l’IA")
})

test("la miniature est plus grande et s'ouvre en lightbox", () => {
  const html = renderToStaticMarkup(
    <CoverField
      value={storageId}
      disabled={false}
      generating={false}
      onChange={() => undefined}
      onGenerate={() => undefined}
    />,
  )
  expect(html).toMatch(/Voir l(&#x27;|')image en entier/)
  expect(html).toContain("aspect-video")
  expect(html).toMatch(/Détails de l(&#x27;|’|')image/)
  expect(html).toContain("Texte alternatif")
  expect(html).toMatch(/Titre de l(&#x27;|')image/)
  expect(html).toContain("Vitrine rénovée")
  expect(html).toContain("Rénover une vitrine")
  expect(html).toContain("Retirer la couverture")
  expect(html).not.toMatch(/>Retirer</)
  expect(html).toContain("gap-2")
  expect(html).toContain("sm:flex-nowrap")
  expect(html).not.toContain("grid-cols-2")
  expect(html).toMatch(/Changer d(&#x27;|')image/)
})

test("compact : aperçu plus petit, sans second bloc OG", () => {
  const html = renderToStaticMarkup(
    <CoverField
      value={storageId}
      disabled={false}
      generating={false}
      compact
      onChange={() => undefined}
      onGenerate={() => undefined}
    />,
  )
  expect(html).toContain("max-w-md")
  expect(html).not.toContain("max-w-xl")
  expect(html).not.toContain("max-w-sm")
  expect(html).not.toContain("Image de partage")
  expect(html).toMatch(/Détails de l(&#x27;|’|')image/)
  expect(html).toContain("Retirer la couverture")
  expect(html).toContain("gap-2")
  expect(html).toContain("sm:flex-nowrap")
  expect(html).not.toContain("grid-cols-2")
})

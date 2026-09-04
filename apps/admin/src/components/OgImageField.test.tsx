import { renderToStaticMarkup } from "react-dom/server"
import { expect, test, vi } from "vitest"

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => async () => undefined,
}))

vi.mock("@/components/media-picker", () => ({
  MediaPicker: () => null,
}))

import { OgImageField } from "./OgImageField"

test("l'aperçu OG est le même rectangle 16:9", () => {
  const html = renderToStaticMarkup(
    <OgImageField
      value={"kg123" as never}
      disabled={false}
      onChange={() => undefined}
    />,
  )
  expect(html).toContain("aspect-video")
  expect(html).toContain("max-w-xl")
  expect(html).not.toContain("size-20")
})

test("sans onGenerate, n'affiche pas le bouton IA", () => {
  const html = renderToStaticMarkup(
    <OgImageField value={null} disabled={false} onChange={() => undefined} />,
  )
  expect(html).not.toContain("Générer avec l’IA")
})

test("avec onGenerate, affiche le bouton IA près du champ", () => {
  const html = renderToStaticMarkup(
    <OgImageField
      value={null}
      disabled={false}
      generating={false}
      onChange={() => undefined}
      onGenerate={() => undefined}
    />,
  )
  expect(html).toContain("Générer avec l’IA")
  expect(html).toContain("Choisir une image")
  expect(html).toContain("sm:flex-nowrap")
})

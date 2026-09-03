import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import source from "./copy-button.tsx?raw"
import { COPIED_LABEL, COPY_RESET_MS, CopyButton } from "./copy-button"

describe("CopyButton", () => {
  test("au repos, l'icône n'affiche pas Copié", () => {
    const html = renderToStaticMarkup(
      <CopyButton value="abc" label="Copier le snippet" />,
    )
    expect(html).toContain('aria-label="Copier le snippet"')
    expect(html).toContain('title="Copier le snippet"')
    expect(html).not.toContain(COPIED_LABEL)
  })

  test("le mode texte montre Copier, pas Copié", () => {
    const html = renderToStaticMarkup(
      <CopyButton value="lien" label="Copier le lien" text="Copier" />,
    )
    expect(html).toContain("Copier")
    expect(html).not.toContain(COPIED_LABEL)
  })

  test("copie dans le presse-papiers et affiche Copié ~2s", () => {
    expect(source).toMatch(/clipboard\.writeText/)
    expect(source).toContain(COPIED_LABEL)
    expect(source).toMatch(new RegExp(String(COPY_RESET_MS)))
    expect(source).toMatch(/aria-live/)
  })
})

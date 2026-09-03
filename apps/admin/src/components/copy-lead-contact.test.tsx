import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { CopyLeadContact } from "./copy-lead-contact"

function render(phone?: string) {
  return renderToStaticMarkup(
    <CopyLeadContact email="camille@example.com" phone={phone} />,
  )
}

describe("CopyLeadContact", () => {
  test("propose de copier l'e-mail", () => {
    const html = render()
    expect(html).toContain("Copier l’e-mail")
    expect(html).toContain('title="Copier l’e-mail"')
    expect(html).toContain('aria-label="Copier l’e-mail"')
  })

  test("propose de copier le téléphone quand il est renseigné", () => {
    const html = render("06 12 34 56 78")
    expect(html).toContain("Copier le téléphone")
    expect(html).toContain('title="Copier le téléphone"')
    expect(html).toContain('aria-label="Copier le téléphone"')
  })

  test("masque la copie du téléphone quand il est vide", () => {
    expect(render()).not.toContain("Copier le téléphone")
    expect(render("   ")).not.toContain("Copier le téléphone")
  })

  test("n'affiche pas Copié tant qu'on n'a pas copié", () => {
    expect(render()).not.toContain("Copié")
  })

  test("sans e-mail, masque le bouton de copie e-mail", () => {
    const html = renderToStaticMarkup(<CopyLeadContact phone="06 12 34 56 78" />)
    expect(html).not.toContain("Copier l’e-mail")
    expect(html).toContain("Copier le téléphone")
  })
})

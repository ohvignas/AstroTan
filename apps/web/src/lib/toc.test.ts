import { describe, expect, it } from "vitest"
import { extractHeadings } from "./toc"

describe("extractHeadings", () => {
  it("ne rend rien sur un corps sans titre", () => {
    const { headings, html } = extractHeadings("<p>Juste un paragraphe.</p>")
    expect(headings).toEqual([])
    expect(html).toBe("<p>Juste un paragraphe.</p>")
  })

  it("relève les h2 et les h3 avec leur profondeur", () => {
    const { headings } = extractHeadings(
      "<h2>Premier</h2><p>x</p><h3>Second</h3>"
    )
    expect(headings).toEqual([
      { depth: 2, slug: "premier", text: "Premier" },
      { depth: 3, slug: "second", text: "Second" },
    ])
  })

  it("pose l'ancre sur le titre du HTML rendu", () => {
    const { html } = extractHeadings("<h2>Mon titre</h2>")
    expect(html).toBe('<h2 id="mon-titre">Mon titre</h2>')
  })

  // Tiptap sort des `<h2>` nus, et le sanitiseur n'autorise pas `id` — donc
  // l'ancre est POSÉE ici, après assainissement. Ce test fige le fait que
  // l'entrée normale n'a pas d'ancre.
  it("ignore h1, h4 et au-delà", () => {
    const { headings } = extractHeadings("<h1>A</h1><h4>B</h4><h2>C</h2>")
    expect(headings.map((h) => h.text)).toEqual(["C"])
  })

  it("déshabille le balisage interne pour le libellé, pas pour le corps", () => {
    const { headings, html } = extractHeadings(
      "<h2>Un <strong>gras</strong> dedans</h2>"
    )
    expect(headings[0]?.text).toBe("Un gras dedans")
    expect(html).toContain("<strong>gras</strong>")
  })

  it("décode les entités dans le libellé et le slug", () => {
    const { headings } = extractHeadings("<h2>Caf&eacute; &amp; th&eacute;</h2>")
    expect(headings[0]?.text).toBe("Café & thé")
    expect(headings[0]?.slug).toBe("cafe-the")
  })

  // Deux titres identiques donneraient deux ancres identiques : le lien du
  // second sauterait au premier, en silence.
  it("désambiguïse deux titres identiques", () => {
    const { headings, html } = extractHeadings("<h2>Notes</h2><h2>Notes</h2>")
    expect(headings.map((h) => h.slug)).toEqual(["notes", "notes-2"])
    expect(html).toBe('<h2 id="notes">Notes</h2><h2 id="notes-2">Notes</h2>')
  })

  // Un titre entièrement non alphanumérique ne peut pas produire de slug ;
  // sans repli il porterait `id=""`, que le navigateur ignore.
  it("donne un repli à un titre sans caractère utilisable", () => {
    const { headings } = extractHeadings("<h2>???</h2>")
    expect(headings[0]?.slug).toBe("section-1")
  })

  it("laisse passer un h2 déjà porteur d'attributs sans les perdre", () => {
    const { html } = extractHeadings('<h2 class="lead">Titre</h2>')
    expect(html).toBe('<h2 class="lead" id="titre">Titre</h2>')
  })

  it("ne compte pas un titre vide", () => {
    const { headings } = extractHeadings("<h2></h2><h2>Vrai</h2>")
    expect(headings.map((h) => h.text)).toEqual(["Vrai"])
  })
})

// Le menu latéral des réglages : ce qu'il doit rendre pour qu'un clavier
// suffise à s'en servir, et pour que l'ancre courante soit lisible.
//
// `vitest.config.ts` est en `environment: "node"` : on rend en chaîne avec
// `renderToStaticMarkup` et on assère sur le HTML, comme
// `save-bar.test.tsx`. C'est assez pour ce qui compte ici — les liens sont
// de vrais `<a href="#…">`, donc focusables et activables par le clavier
// sans une ligne de JavaScript, et c'est précisément l'invariant qu'un
// `<div onClick>` casserait sans que rien ne le signale.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { SETTINGS_SECTIONS, SettingsNav } from "./settings-nav"

function render(current: string) {
  return renderToStaticMarkup(<SettingsNav current={current} />)
}

/** « Leads & webhook » sort du rendu en `Leads &amp; webhook`. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

describe("SETTINGS_SECTIONS", () => {
  test("porte les huit sections attendues, dans l'ordre de l'écran", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      "site",
      "seo",
      "reseaux",
      "leads",
      "ia",
      "emails",
      "domaine",
      "mesure",
    ])
  })

  test("aucun identifiant en double", () => {
    // Deux sections de même `id` produiraient deux `<section id>` identiques :
    // l'ancre du menu n'en atteindrait qu'une, et toujours la même.
    const ids = SETTINGS_SECTIONS.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("SettingsNav", () => {
  test("chaque section est un lien d'ancre, pas un bouton sans adresse", () => {
    const html = render("site")
    for (const section of SETTINGS_SECTIONS) {
      expect(html).toContain(`href="#${section.id}"`)
      expect(html).toContain(escapeHtml(section.label))
    }
    // Aucun `<button>` : un bouton qui déplace la page ne se copie pas, ne
    // s'ouvre pas dans un onglet et n'apparaît pas dans la liste des liens
    // d'un lecteur d'écran.
    expect(html).not.toContain("<button")
  })

  test("l'ancre courante est annoncée, et elle seule", () => {
    const html = render("leads")
    const marques = html.match(/aria-current="true"/g) ?? []
    expect(marques).toHaveLength(1)
    // La marque doit porter sur le bon lien, pas seulement exister quelque
    // part : `aria-current` posé sur le premier lien passerait un simple
    // comptage.
    expect(html).toMatch(/<a[^>]*href="#leads"[^>]*aria-current="true"/)
  })

  test("une ancre inconnue ne marque rien plutôt que de marquer au hasard", () => {
    const html = render("section-qui-n-existe-pas")
    expect(html).not.toContain('aria-current="true"')
  })

  test("le menu se nomme, pour qui navigue de repère en repère", () => {
    const html = render("site")
    expect(html).toMatch(/<nav[^>]*aria-label="/)
  })
})

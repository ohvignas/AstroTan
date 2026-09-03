import { expect, test } from "vitest"
import {
  MIN_RAG_PAGE_CHARS,
  cleanDocumentForRag,
  htmlToMainMarkdown,
  isTooShortForRag,
} from "./cleanDocumentForRag"
import { knowledgeEntries, pageEntry } from "./ragSources"

test("le markdown perd les caractères de contrôle et les lignes vides en trop", () => {
  const dirty = "# FAQ\n\n\n\n\nLe code\u0000 secret est ORION-42.\n\n\n\n"
  expect(cleanDocumentForRag(dirty)).toBe("# FAQ\n\nLe code secret est ORION-42.")
})

test("un saut de page PDF et un pied 'Page N' disparaissent, les titres restent", () => {
  const dirty = "# Offre\n\nTarif 80 €.\fPage 1\n# Offre\n\nSur devis.\nPage 2"
  const cleaned = cleanDocumentForRag(dirty)
  expect(cleaned).toContain("# Offre")
  expect(cleaned).toContain("Tarif 80 €.")
  expect(cleaned).toContain("Sur devis.")
  expect(cleaned).not.toMatch(/Page \d/)
  expect(cleaned).not.toContain("\f")
})

test("un HTML avec nav et footer n'embarque pas ces chaînes", () => {
  const html = `
    <html><body>
      <header><nav>Menu Accueil Contact</nav></header>
      <main>
        <h1>Horaires</h1>
        <p>Ouvert du lundi au vendredi, 9h–18h.</p>
        <ul><li>Samedi sur rendez-vous</li></ul>
      </main>
      <footer>Mentions légales — © AstroTan</footer>
      <script>window.track()</script>
    </body></html>
  `
  const cleaned = htmlToMainMarkdown(html)
  expect(cleaned).toContain("# Horaires")
  expect(cleaned).toContain("Ouvert du lundi au vendredi, 9h–18h.")
  expect(cleaned).toContain("- Samedi sur rendez-vous")
  expect(cleaned).not.toContain("Menu Accueil Contact")
  expect(cleaned).not.toContain("Mentions légales")
  expect(cleaned).not.toContain("window.track")
})

test("sans <main>, on prend <article> et on retire header / noscript", () => {
  const html = `
    <body>
      <header>Barre du haut</header>
      <article><h2>Contact</h2><p>Écrivez-nous à hello@exemple.fr pour un devis.</p></article>
      <noscript>Activez JavaScript</noscript>
    </body>
  `
  const cleaned = htmlToMainMarkdown(html)
  expect(cleaned).toContain("## Contact")
  expect(cleaned).toContain("hello@exemple.fr")
  expect(cleaned).not.toContain("Barre du haut")
  expect(cleaned).not.toContain("Activez JavaScript")
})

test("un texte trop court après nettoyage n'entre pas dans l'index", () => {
  expect(isTooShortForRag("ok")).toBe(true)
  expect(isTooShortForRag("x".repeat(MIN_RAG_PAGE_CHARS))).toBe(false)
  expect(pageEntry({ slug: "vide", title: "Vide" }, "<nav>Menu</nav><main>  </main>")).toBeNull()
  expect(pageEntry({ slug: "ok", title: "Ok" }, "   ")).toBeNull()
})

test("une page HTML assez longue est indexée sans le chrome", () => {
  const entry = pageEntry(
    { slug: "accueil", title: "Accueil" },
    `<nav>Menu Accueil</nav><main><h1>Accueil</h1><p>Nous recevons sur rendez-vous du lundi au vendredi.</p></main><footer>Mentions légales</footer>`,
  )
  expect(entry).not.toBeNull()
  expect(entry?.text).toContain("# Accueil")
  expect(entry?.text).toContain("Nous recevons sur rendez-vous")
  expect(entry?.text).not.toContain("Menu Accueil")
  expect(entry?.text).not.toContain("Mentions légales")
})

test("knowledgeEntries nettoie avant d'ajouter et saute un fichier vide après clean", () => {
  const entries = knowledgeEntries(
    [
      {
        id: "file-1",
        filename: "faq.md",
        extractedMarkdown: "# FAQ\n\n\n\nLe code\u0000 secret est ORION-42.",
      },
      { id: "file-2", filename: "bruit.md", extractedMarkdown: "\u0000\n\n\n" },
    ],
    "  Horaires : 9h-18h  ",
  )
  expect(entries.map((entry) => entry.key)).toEqual(["knowledge:file-1", "knowledge:settings"])
  expect(entries[0]?.text).toBe("# FAQ\n\nLe code secret est ORION-42.")
  expect(entries[1]?.text).toBe("Horaires : 9h-18h")
})

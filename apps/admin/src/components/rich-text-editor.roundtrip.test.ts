// @vitest-environment jsdom
import { Editor } from "@tiptap/core"
import { describe, expect, test } from "vitest"
import { postBodyExtensions, readHtml } from "./rich-text-editor"

// L'aller-retour, mesuré — et pourquoi il tient cette fois.
//
// Le corps d'un article n'est plus du Markdown : `posts.body` contient le
// HTML que ProseMirror sérialise depuis son propre document. Les pertes
// relevées auparavant (`markdown-editor.roundtrip.test.ts`) portaient
// toutes sur la conversion *vers du Markdown* — un modèle de document n'a
// nulle part où ranger « cette puce était un `-` », « ce lien avait un
// titre », « cette ligne était un retour souple ». En HTML ces
// informations n'existent pas : le modèle et la sortie décrivent la même
// chose.
//
// Ce qui reste à vérifier n'est donc pas « la chaîne est-elle identique »
// — Tiptap normalise, légitimement — mais deux propriétés plus fortes :
//
//   1. la normalisation est un point fixe : un second passage ne change
//      plus rien. Sans cela, un article rechargé puis réenregistré
//      dériverait à chaque tour ;
//   2. rien n'est *perdu* : chaque élément que la barre d'outils sait
//      produire ressort du passage, et le jeu de balises produit reste un
//      sous-ensemble de l'allow-list du site.

/** Monte un éditeur sans interface et rend le HTML qu'il sérialise. */
function roundTrip(html: string): string {
  const editor = new Editor({ extensions: postBodyExtensions(), content: html })
  try {
    return editor.getHTML()
  } finally {
    editor.destroy()
  }
}

/**
 * Ce qu'un article contient, une construction par bouton de la barre
 * d'outils — plus les deux cas sur lesquels le nœud image *de bloc* avait
 * échoué au banc d'essai précédent : l'image entourée d'un lien, et
 * l'image posée au milieu d'un paragraphe.
 */
const FIXTURES: Record<string, string> = {
  "titres de section et sous-titres":
    "<h2>Titre de section</h2><p>Du texte.</p><h3>Sous-titre</h3><p>Encore.</p>",

  "titres hors barre d'outils, lus sans être rétrogradés":
    "<h1>Un titre de niveau 1</h1><h4>Un titre de niveau 4</h4>",

  "marques inline":
    "<p>Du <strong>gras</strong>, de l'<em>italique</em>, du <s>barré</s> et du <code>code inline</code>.</p>",

  "marques inline combinées":
    "<p><strong>gras et <em>italique</em></strong></p>",

  "liste à puces imbriquée":
    "<ul><li><p>premier</p><ul><li><p>imbriqué</p></li></ul></li><li><p>second</p></li></ul>",

  "liste numérotée":
    "<ol><li><p>étape une</p></li><li><p>étape deux</p></li></ol>",

  citation: "<blockquote><p>Une citation.</p></blockquote>",

  "bloc de code avec langage":
    '<pre><code class="language-ts">const a = 1</code></pre>',

  séparateur: "<p>avant</p><hr><p>après</p>",

  lien: '<p>Un <a rel="noopener noreferrer" href="https://example.com">lien</a> dans une phrase.</p>',

  "lien mailto":
    '<p><a rel="noopener noreferrer" href="mailto:contact@example.com">écrire</a></p>',

  "image au milieu d'un paragraphe":
    '<p>avant <img src="https://example.com/a.webp" alt="une image"> après</p>',

  "image entourée d'un lien":
    '<p><a rel="noopener noreferrer" href="https://example.com"><img src="https://example.com/a.webp" alt="une image"></a></p>',

  "article complet":
    '<h2>Introduction</h2><p>Un paragraphe avec du <strong>gras</strong> et un <a rel="noopener noreferrer" href="https://example.com">lien</a>.</p><ul><li><p>un point</p></li><li><p>un autre</p></li></ul><h3>Détail</h3><blockquote><p>Une citation.</p></blockquote><pre><code>npm run build</code></pre><hr><p>Fin. <img src="https://example.com/a.webp" alt="illustration"></p>',
}

describe("l'aller-retour du corps d'un article", () => {
  test.each(Object.entries(FIXTURES))(
    "%s — la normalisation est un point fixe",
    (_name, html) => {
      const once = roundTrip(html)
      expect(roundTrip(once)).toBe(once)
    }
  )

  test.each(Object.entries(FIXTURES))(
    "%s — le texte survit intégralement",
    (_name, html) => {
      const textOf = (source: string) =>
        source
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      expect(textOf(roundTrip(html))).toBe(textOf(html))
    }
  )
})

describe("les éléments qui doivent survivre nommément", () => {
  test("un titre de niveau 1 n'est pas rétrogradé en paragraphe", () => {
    // Le cas d'un corps migré depuis du Markdown : la barre d'outils
    // n'expose pas `H1`, mais l'éditeur doit savoir le relire.
    expect(roundTrip("<h1>Titre</h1>")).toContain("<h1>")
  })

  test("le langage d'un bloc de code est conservé", () => {
    expect(roundTrip('<pre><code class="language-ts">const a = 1</code></pre>'))
      .toContain("language-ts")
  })

  test("l'adresse d'un lien est conservée", () => {
    const html = roundTrip('<p><a href="https://example.com/page">texte</a></p>')
    expect(html).toContain('href="https://example.com/page"')
  })

  test("un lien mailto n'est pas retiré", () => {
    const html = roundTrip('<p><a href="mailto:contact@example.com">écrire</a></p>')
    expect(html).toContain("mailto:contact@example.com")
  })

  test("une image inline reste dans le paragraphe qui la contient", () => {
    // Le nœud image *de bloc* coupait le paragraphe en deux et collait
    // l'image sur le bloc voisin — c'est précisément ce que
    // `inline: true` évite.
    const html = roundTrip(
      '<p>avant <img src="https://example.com/a.webp" alt="x"> après</p>'
    )
    expect(html.match(/<p>/g)).toHaveLength(1)
    expect(html).toContain('src="https://example.com/a.webp"')
    expect(html).toContain('alt="x"')
  })

  test("une image entourée d'un lien le reste", () => {
    const html = roundTrip(
      '<p><a href="https://example.com"><img src="https://example.com/a.webp" alt="x"></a></p>'
    )
    expect(html).toMatch(/<a[^>]*>\s*<img[^>]*>\s*<\/a>/)
  })

  test("le texte alternatif d'une image sans lien est conservé", () => {
    expect(
      roundTrip('<p><img src="https://example.com/a.webp" alt="une légende"></p>')
    ).toContain('alt="une légende"')
  })
})

describe("les balises produites tiennent dans l'allow-list du site", () => {
  // Recopie de `ALLOWED_TAGS` dans `apps/web/src/lib/markdown.ts` : ce que
  // l'éditeur produit hors de cette liste serait retiré en silence de
  // l'article publié, sans que rien ne le signale au tableau de bord.
  const ALLOWED_TAGS = new Set([
    "p", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "b", "em", "i", "u", "s", "sub", "sup",
    "ul", "ol", "li",
    "a", "img",
    "blockquote", "code", "pre",
    "table", "thead", "tbody", "tr", "th", "td",
    "span", "div",
  ])

  test.each(Object.entries(FIXTURES))("%s", (_name, html) => {
    const produced = new Set(
      [...roundTrip(html).matchAll(/<\/?([a-z0-9]+)/gi)].map((match) =>
        (match[1] ?? "").toLowerCase()
      )
    )
    expect([...produced].filter((tag) => !ALLOWED_TAGS.has(tag))).toEqual([])
  })
})

describe("le vide", () => {
  test("un document vide se lit comme la chaîne vide, pas comme <p></p>", () => {
    const editor = new Editor({ extensions: postBodyExtensions(), content: "" })
    try {
      // `getHTML()` rend `<p></p>` — sept caractères qui compteraient dans
      // la limite et marqueraient le formulaire modifié au chargement.
      expect(editor.getHTML()).toBe("<p></p>")
      expect(readHtml(editor)).toBe("")
    } finally {
      editor.destroy()
    }
  })

  test("un document non vide se lit comme son HTML", () => {
    const editor = new Editor({
      extensions: postBodyExtensions(),
      content: "<p>du texte</p>",
    })
    try {
      expect(readHtml(editor)).toBe("<p>du texte</p>")
    } finally {
      editor.destroy()
    }
  })
})

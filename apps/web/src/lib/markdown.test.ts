import { describe, expect, test } from "vitest"
import {
  markdownToPlainText,
  renderInline,
  renderMarkdown,
  renderStoredHtml,
} from "./markdown"

// `renderMarkdown`'s output goes straight into `set:html` on every public
// page and every preview. Every case in the first block below is markup
// that reaches a visitor as raw HTML if the sanitiser is removed or
// reordered — these are not style tests.

describe("ce qui ne doit jamais atteindre un visiteur", () => {
  test("une balise script écrite en HTML brut est supprimée", () => {
    // Markdown passes raw HTML through by design, so "it's only Markdown"
    // is not a safety property — this is the case that proves it.
    const html = renderMarkdown("Bonjour <script>alert(1)</script> tout le monde")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("alert(1)")
    expect(html).toContain("Bonjour")
  })

  test("un gestionnaire d'événement en ligne est supprimé", () => {
    const html = renderMarkdown('<p onclick="steal()">Cliquez</p>')
    expect(html).not.toContain("onclick")
    expect(html).toContain("Cliquez")
  })

  test("un lien javascript: est neutralisé, y compris via la syntaxe Markdown", () => {
    const html = renderMarkdown("[Cliquez](javascript:alert(1))")
    expect(html).not.toContain("javascript:")
  })

  test("une image à src data: est neutralisée", () => {
    const html = renderMarkdown('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="x">')
    expect(html).not.toContain("data:")
  })

  test("une iframe est supprimée", () => {
    const html = renderMarkdown('<iframe src="https://evil.example"></iframe>')
    expect(html).not.toContain("<iframe")
  })

  test("un attribut style est supprimé", () => {
    const html = renderMarkdown('<p style="position:fixed;inset:0">Recouvrement</p>')
    expect(html).not.toContain("style=")
  })

  test("l'ordre est le bon : on rend puis on assainit", () => {
    // Sanitising the *source* first would leave the parser free to emit
    // whatever the source's raw-HTML passthrough contained afterwards.
    // A fenced code block containing a script tag proves the pipeline ran
    // in the right order: the tag survives as escaped *text*, never as an
    // element.
    const html = renderMarkdown("```\n<script>alert(1)</script>\n```")
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })
})

describe("ce qui doit survivre", () => {
  test("les titres, l'emphase et les listes sont rendus", () => {
    const html = renderMarkdown("# Titre\n\nUn *mot* en **gras**.\n\n- un\n- deux")
    expect(html).toContain("<h1>Titre</h1>")
    expect(html).toContain("<em>mot</em>")
    expect(html).toContain("<strong>gras</strong>")
    expect(html).toContain("<li>un</li>")
  })

  test("un lien https garde son href et reçoit rel=noopener", () => {
    const html = renderMarkdown("[AstroTan](https://illith.com)")
    expect(html).toContain('href="https://illith.com"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  test("les liens mailto et tel passent", () => {
    expect(renderMarkdown("[Écrire](mailto:a@b.com)")).toContain("mailto:a@b.com")
    expect(renderMarkdown("[Appeler](tel:+33100000000)")).toContain("tel:+33100000000")
  })

  test("la langue d'un bloc de code est conservée", () => {
    // The class is what a highlighter keys off; dropping it would silently
    // turn every code block into plain text.
    expect(renderMarkdown("```ts\nconst a = 1\n```")).toContain("language-ts")
  })

  test("un corps vide rend une chaîne vide, sans exploser", () => {
    expect(renderMarkdown("")).toBe("")
  })
})

describe("markdownToPlainText", () => {
  test("retire le balisage et garde le texte des liens, pas leur URL", () => {
    // A meta description wants the words, never the address.
    const text = markdownToPlainText("# Titre\n\nVoir [le site](https://illith.com).")
    expect(text).toBe("Titre Voir le site.")
  })

  test("coupe sur un mot entier et signale la coupure", () => {
    const text = markdownToPlainText("alpha bravo charlie delta", 14)
    expect(text).toBe("alpha bravo…")
    expect(text.length).toBeLessThanOrEqual(15)
  })

  test("ne coupe pas un texte déjà assez court", () => {
    expect(markdownToPlainText("court", 200)).toBe("court")
  })

  test("restitue les caractères que l'assainisseur encode", () => {
    // Without the decoding pass this reads "Tom &amp; Jerry" in a
    // `<meta description>`, which is what the browser then displays.
    expect(markdownToPlainText("Tom & Jerry")).toBe("Tom & Jerry")
  })
})

describe("renderInline — les champs de contenu déclarés « rich »", () => {
  test("rend le gras et l'italique", () => {
    expect(renderInline("**4,8/5** sur les avis Google")).toBe(
      "<strong>4,8/5</strong> sur les avis Google"
    )
    expect(renderInline("_ILLITH_")).toContain("<em>ILLITH</em>")
  })

  test("n'émet jamais de balise de bloc, même si le texte en demande une", () => {
    // The field sits inside a heading or a button. A `# ` that produced an
    // `<h1>` there would break out of the element the design put it in —
    // which is why this is a separate function rather than `renderMarkdown`
    // with a narrower allowlist.
    const html = renderInline("# Un titre\n\nUn paragraphe")
    expect(html).not.toContain("<h1")
    expect(html).not.toContain("<p>")
  })

  test("assainit comme le rendu de bloc", () => {
    expect(renderInline("<script>alert(1)</script>")).not.toContain("<script")
    expect(renderInline("[x](javascript:alert(1))")).not.toContain("javascript:")
  })

  test("laisse passer un lien légitime, avec rel=noopener", () => {
    const html = renderInline("[ILLITH](https://illith.com)")
    expect(html).toContain('href="https://illith.com"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})

describe("renderStoredHtml — le corps d'article, désormais du HTML", () => {
  test("laisse passer le balisage que l'éditeur produit", () => {
    const html = renderStoredHtml(
      '<h2>Titre</h2><p>Un <strong>mot</strong> et un <a href="https://illith.com">lien</a>.</p><ul><li>un</li></ul>'
    )
    expect(html).toContain("<h2>Titre</h2>")
    expect(html).toContain("<strong>mot</strong>")
    expect(html).toContain("<li>un</li>")
  })

  test("assainit exactement comme le rendu Markdown", () => {
    // Le stockage a changé, la barrière non : la valeur vient d'une session
    // authentifiée, jamais d'un visiteur, et elle est assainie quand même.
    expect(renderStoredHtml("<p>a</p><script>alert(1)</script>")).not.toContain("<script")
    expect(renderStoredHtml('<p onclick="x()">a</p>')).not.toContain("onclick")
    expect(renderStoredHtml('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:")
    expect(renderStoredHtml('<iframe src="https://evil.example"></iframe>')).not.toContain("<iframe")
  })

  test("ajoute rel=noopener aux liens, comme l'autre chemin", () => {
    expect(renderStoredHtml('<a href="https://illith.com">x</a>')).toContain(
      'rel="noopener noreferrer"'
    )
  })
})

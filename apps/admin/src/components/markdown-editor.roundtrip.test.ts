import { describe, expect, it } from "vitest"
import { EditorState } from "@codemirror/state"
import {
  insertLink,
  toggleBulletList,
  toggleCodeBlock,
  toggleHeading,
  toggleInlineMark,
  toggleOrderedList,
  toggleQuote,
} from "@/lib/markdown-commands"

// L'aller-retour, mesuré — et pourquoi il n'y en a pas vraiment un.
//
// `posts.body` est du Markdown, et trois choses en dépendent : le site
// public le rend par `renderMarkdown` (`apps/web/src/lib/markdown.ts`), le
// nettoyeur suppose du Markdown, et un agent doit pouvoir lire et réécrire
// le champ comme du texte. Un éditeur qui tient un modèle de document et
// re-sérialise vers du Markdown à chaque frappe casse les trois : le
// modèle n'a aucun endroit où ranger « cette puce était un `-` », « ce lien
// avait un titre », « cette ligne était un retour souple ».
//
// C'est mesuré, pas supposé. Sur le corpus ci-dessous, avant tout choix :
//
//   - remark seul (remark-parse → remark-stringify, options ajustées) :
//     identique, et idempotent au second passage. C'est le plancher.
//   - Plate 53 (Slate) avec l'ensemble complet des plugins de nœuds :
//     le *titre* du lien disparaît — `[lien](url "titre")` ressort
//     `[lien](url)` — et le retour souple en fin de ligne devient un retour
//     dur (`\` en fin de ligne), ce qui change le rendu. Plus les
//     normalisations `-` → `*`, `*ital*` → `_ital_`, `---` → `***`.
//   - Tiptap 3 + `tiptap-markdown` 0.9 avec StarterKit : le tableau entier
//     ressort concaténé en une ligne de texte (`Colonne AColonne Bvaleur 1…`)
//     et l'image disparaît. Avec `@tiptap/extension-table` et
//     `@tiptap/extension-image` en plus, l'image et le tableau ressortent
//     collés sur la même ligne, sans la ligne vide qui les sépare — donc du
//     Markdown invalide.
//
// D'où CodeMirror 6 : son document *est* la chaîne. Il n'y a pas d'analyse
// puis de re-sérialisation, donc pas d'aller-retour au sens propre —
// l'arbre de syntaxe ne sert qu'à colorer. Ce fichier vérifie que cette
// propriété tient vraiment, y compris après édition, et borne la seule
// normalisation que CodeMirror applique.

/**
 * Le corpus : ce qu'un article contient réellement, plus les constructions
 * sur lesquelles les éditeurs à modèle de document ont échoué ci-dessus.
 */
const FIXTURES: Record<string, string> = {
  "titres, gras, italique, code inline":
    "# Titre\n\nUn paragraphe avec du **gras**, de l'*italique*, de l'_italique souligné_\net du `code inline`.\n",

  "liens, avec et sans titre":
    'Un [lien](https://example.com), un [lien titré](https://example.com "le titre"),\nun <https://example.com/auto> et une [référence][ref].\n\n[ref]: https://example.com/ref "titre de la référence"\n',

  "listes à puces imbriquées":
    "- premier point\n- deuxième point\n  - point imbriqué\n    - encore plus profond\n  - autre point imbriqué\n- troisième point\n",

  "listes numérotées et listes de tâches":
    "1. étape une\n2. étape deux\n   1. sous-étape\n3. étape trois\n\n- [ ] à faire\n- [x] fait\n",

  "citations sur plusieurs paragraphes":
    "> Une citation.\n>\n> Et un second paragraphe.\n>\n> > Et une citation imbriquée.\n",

  "bloc de code avec langage":
    "```ts\nconst x: number = 1\nconsole.log(x)\n```\n\n    un bloc de code indenté\n    sur deux lignes\n",

  "images et tableau":
    '![Texte alternatif](https://example.com/image.png "titre")\n\n| Colonne A | Colonne B |\n| --------- | --------: |\n| valeur 1  |  valeur 2 |\n| valeur 3  |  valeur 4 |\n',

  "règles horizontales et retours durs":
    "Une ligne suivie d'un retour dur  \net la suite.\n\nUn retour dur par barre oblique inversée\\\net la suite.\n\n---\n\n***\n\n___\n",

  "HTML brut et échappements":
    "Un <em>fragment HTML</em> et un <!-- commentaire -->.\n\nUn astérisque échappé \\* et un dollar 100 $, plus &amp; une entité.\n",

  "document vide": "",

  "un seul mot sans saut de ligne final": "bonjour",
}

/** Le document de CodeMirror, relu en chaîne. */
function throughEditor(markdown: string): string {
  return EditorState.create({ doc: markdown }).doc.toString()
}

describe("le document de l'éditeur est le Markdown, octet pour octet", () => {
  for (const [name, markdown] of Object.entries(FIXTURES)) {
    it(`conserve ${name}`, () => {
      expect(throughEditor(markdown)).toBe(markdown)
    })
  }

  it("conserve l'intégralité du corpus concaténé", () => {
    const whole = Object.values(FIXTURES).join("\n")
    expect(throughEditor(whole)).toBe(whole)
  })

  it("conserve un corps proche de MAX_POST_BODY_LENGTH", () => {
    // 200 000 caractères est la borne que `posts.update` applique. Un
    // éditeur qui se dégrade au-delà de quelques milliers de caractères
    // n'est pas utilisable pour ce champ ; celui-ci rend le document par
    // fenêtre, mais c'est la fidélité qu'on vérifie ici, pas la vitesse.
    const long = FIXTURES["liens, avec et sans titre"]!.repeat(1200)
    expect(long.length).toBeGreaterThan(200_000)
    expect(throughEditor(long)).toBe(long)
  })
})

describe("l'édition ne réécrit que ce qui est édité", () => {
  const source = FIXTURES["images et tableau"]!

  it("rend le document intact après une insertion puis son retrait", () => {
    const start = EditorState.create({ doc: source })
    const inserted = start.update({
      changes: { from: 0, insert: "Préambule.\n\n" },
    }).state
    const removed = inserted.update({
      changes: { from: 0, to: "Préambule.\n\n".length },
    }).state
    expect(removed.doc.toString()).toBe(source)
  })

  it("ne touche pas au reste du document quand on édite une ligne", () => {
    const start = EditorState.create({ doc: source })
    const line = start.doc.line(3)
    const next = start.update({
      changes: { from: line.from, to: line.to, insert: "| A | B |" },
    }).state
    // Le tableau perd sa ligne d'en-tête d'origine — c'est l'édition
    // demandée — mais l'image et son titre, deux lignes plus haut, sont
    // exactement ceux d'avant. C'est là que les éditeurs à modèle de
    // document perdent le titre du lien ou l'image entière.
    expect(next.doc.line(1).text).toBe(
      '![Texte alternatif](https://example.com/image.png "titre")'
    )
    expect(next.doc.toString().endsWith("| valeur 3  |  valeur 4 |\n")).toBe(
      true
    )
  })
})

describe("la seule normalisation : les fins de ligne", () => {
  // Documenté plutôt que corrigé. `EditorState.create` découpe sur
  // `/\r\n?|\n/` et le document se relit en `\n` — un CRLF collé depuis
  // Windows ressort en LF. C'est une normalisation *sûre* : `marked` rend
  // les deux à l'identique, et `body.length` (la borne côté Convex) ne peut
  // que diminuer. Le noter ici est ce qui empêche de la redécouvrir comme
  // un bug.
  it("convertit CRLF en LF", () => {
    expect(throughEditor("une\r\ndeux\r\n")).toBe("une\ndeux\n")
  })

  it("convertit un CR isolé en LF", () => {
    expect(throughEditor("une\rdeux")).toBe("une\ndeux")
  })

  it("ne touche à aucun autre caractère de contrôle ou espace", () => {
    const odd =
      "espaces   multiples\ttabulation\nespace insécable ici\némoji 🇫🇷 et accent é\n"
    expect(throughEditor(odd)).toBe(odd)
  })
})

// ---------------------------------------------------------------------
// Les commandes de la barre d'outils
//
// Le corollaire de « pas d'aller-retour » : ce sont ces fonctions, et
// elles seules, qui réécrivent du Markdown. Chacune doit être réversible —
// un second clic sur le même bouton rend le document d'origine — sans quoi
// la barre d'outils devient la source de perte que l'éditeur évitait.
// ---------------------------------------------------------------------

function applyAt(
  doc: string,
  transform: ReturnType<typeof toggleQuote>,
  from: number,
  to = from
): string {
  const state = EditorState.create({
    doc,
    selection: { anchor: from, head: to },
  })
  return state.update(transform(state)).state.doc.toString()
}

function applyTwiceAt(
  doc: string,
  transform: ReturnType<typeof toggleQuote>,
  from: number,
  to = from
): string {
  const first = EditorState.create({
    doc,
    selection: { anchor: from, head: to },
  })
  const afterFirst = first.update(transform(first)).state
  return afterFirst.update(transform(afterFirst)).state.doc.toString()
}

describe("les marques inline", () => {
  it("enveloppe une sélection", () => {
    expect(applyAt("bonjour le monde", toggleInlineMark("**"), 8, 10)).toBe(
      "bonjour **le** monde"
    )
  })

  it("retire les marques quand elles encadrent la sélection", () => {
    expect(
      applyAt("bonjour **le** monde", toggleInlineMark("**"), 10, 12)
    ).toBe("bonjour le monde")
  })

  it("retire les marques quand la sélection les contient", () => {
    expect(applyAt("bonjour **le** monde", toggleInlineMark("**"), 8, 14)).toBe(
      "bonjour le monde"
    )
  })

  it("étend au mot sous le curseur, accents compris", () => {
    expect(applyAt("déjà vu", toggleInlineMark("*"), 2)).toBe("*déjà* vu")
  })

  it("insère une paire vide quand il n'y a pas de mot", () => {
    expect(applyAt("a  b", toggleInlineMark("`"), 2)).toBe("a `` b")
  })

  it("est réversible sur le gras, l'italique et le code", () => {
    for (const marker of ["**", "*", "`"]) {
      expect(
        applyTwiceAt("bonjour le monde", toggleInlineMark(marker), 8, 10)
      ).toBe("bonjour le monde")
    }
  })
})

describe("les commandes de ligne", () => {
  it("pose un titre et remplace celui qui était là", () => {
    expect(applyAt("# Titre\n", toggleHeading(2), 3)).toBe("## Titre\n")
  })

  it("retire le titre quand on redemande le même niveau", () => {
    expect(applyAt("## Titre\n", toggleHeading(2), 4)).toBe("Titre\n")
  })

  it("cite et dé-cite un bloc entier", () => {
    const doc = "une\ndeux\n"
    expect(applyAt(doc, toggleQuote(), 0, 8)).toBe("> une\n> deux\n")
    expect(applyTwiceAt(doc, toggleQuote(), 0, 8)).toBe(doc)
  })

  it("transforme un paragraphe en liste à puces et revient", () => {
    const doc = "une\ndeux\n"
    expect(applyAt(doc, toggleBulletList(), 0, 8)).toBe("- une\n- deux\n")
    expect(applyTwiceAt(doc, toggleBulletList(), 0, 8)).toBe(doc)
  })

  it("préserve l'indentation qui porte l'imbrication", () => {
    expect(applyAt("une\n  deux\n", toggleBulletList(), 0, 10)).toBe(
      "- une\n  - deux\n"
    )
  })

  it("renumérote une liste ordonnée de 1 à n", () => {
    expect(applyAt("3. une\n7. deux\n", toggleOrderedList(), 0, 14)).toBe(
      "une\ndeux\n"
    )
    expect(applyAt("une\ndeux\ntrois\n", toggleOrderedList(), 0, 14)).toBe(
      "1. une\n2. deux\n3. trois\n"
    )
  })

  it("échange puces et numéros sans empiler les marqueurs", () => {
    expect(applyAt("- une\n- deux\n", toggleOrderedList(), 0, 12)).toBe(
      "1. une\n2. deux\n"
    )
  })

  it("clôture un bloc de code et retire la clôture", () => {
    const doc = "const x = 1\n"
    expect(applyAt(doc, toggleCodeBlock(), 0, 11)).toBe(
      "```\nconst x = 1\n```\n"
    )
    expect(applyAt("```ts\nconst x = 1\n```\n", toggleCodeBlock(), 0, 20)).toBe(
      "const x = 1\n"
    )
  })
})

describe("l'insertion de lien", () => {
  it("fait de la sélection le libellé", () => {
    expect(applyAt("voir ici", insertLink(), 5, 8)).toBe("voir [ici](https://)")
  })

  it("fait de la sélection la cible quand c'est une URL", () => {
    expect(applyAt("voir https://example.com", insertLink(), 5, 24)).toBe(
      "voir [texte du lien](https://example.com)"
    )
  })

  it("insère un gabarit complet sur un curseur seul", () => {
    expect(applyAt("voir ", insertLink(), 5)).toBe(
      "voir [texte du lien](https://)"
    )
  })

  it("produit un lien que renderMarkdown reconnaîtra", () => {
    // La forme exacte compte : `[libellé](cible)`, sans espace entre le
    // crochet fermant et la parenthèse, sinon ce n'est plus un lien.
    expect(applyAt("ici", insertLink(), 0, 3)).toMatch(
      /^\[ici\]\(https:\/\/\)$/
    )
  })
})

import { EditorSelection } from "@codemirror/state"
import type { EditorState, TransactionSpec } from "@codemirror/state"

// Les commandes de la barre d'outils, en tant que transformations de texte.
//
// Elles vivent ici plutôt que dans `markdown-editor.tsx` pour une raison
// qui n'est pas de l'esthétique : ce sont elles, et non le composant, qui
// décident du Markdown qui finira dans Convex. Un module sans React ni DOM
// se teste dans l'environnement `node` que `vitest.config.ts` configure
// déjà, sans jsdom ni Testing Library — voir
// `components/markdown-editor.roundtrip.test.ts`.
//
// Toutes prennent un `EditorState` et rendent un `TransactionSpec`. Le
// document de CodeMirror *est* la chaîne Markdown : il n'y a pas de modèle
// intermédiaire, donc aucune de ces fonctions ne peut « normaliser » le
// reste du document au passage. C'est l'invariant qui a décidé du choix de
// l'éditeur, et le garder visible ici est ce qui l'empêche de se perdre.

export type MarkdownTransform = (state: EditorState) => TransactionSpec

/** `## ` … `###### `, avec l'espace que CommonMark exige après les dièses. */
const HEADING_RE = /^(#{1,6})[ \t]+/
/** `> `, l'espace étant facultatif : `>texte` est une citation valide. */
const QUOTE_RE = /^[ \t]*>[ \t]?/
/** L'indentation est capturée à part pour ne pas aplatir les listes imbriquées. */
const BULLET_RE = /^([ \t]*)[-*+][ \t]+/
const ORDERED_RE = /^([ \t]*)\d+[.)][ \t]+/
/** Une clôture de bloc de code, avec son langage éventuel. */
const FENCE_RE = /^[ \t]*(```|~~~)/
/** Ce qu'on considère comme une URL déjà écrite, pour ne pas l'envelopper. */
const URL_RE = /^(https?:\/\/|mailto:|tel:|\/|#)/

/**
 * Les caractères qu'un double-clic sélectionnerait.
 *
 * `\p{L}` plutôt que `[a-z]` : le tableau de bord est en français, et un
 * `Ctrl+B` sur « déjà » qui n'attrape que « d » est un bug qu'on ne voit
 * qu'en production.
 */
const WORD_RE_BEFORE = /[\p{L}\p{N}_'-]+$/u
const WORD_RE_AFTER = /^[\p{L}\p{N}_'-]+/u

/**
 * Poser ou retirer une paire de marques inline (`**`, `*`, `` ` ``).
 *
 * Trois cas, dans cet ordre :
 *
 *  1. les marques encadrent déjà la sélection *à l'extérieur*
 *     (`**|gras|**`) — on les retire ;
 *  2. la sélection les contient *à l'intérieur* (`|**gras**|`) — on les
 *     retire aussi, parce qu'une sélection posée au double-clic tombe
 *     tantôt d'un côté tantôt de l'autre et qu'un bouton qui ne
 *     dé-graisse qu'une fois sur deux ne sert à rien ;
 *  3. sinon on enveloppe.
 *
 * Curseur seul : on étend au mot sous le curseur, comme le fait tout
 * traitement de texte. S'il n'y a pas de mot, on insère la paire vide et
 * on place le curseur entre les deux marques.
 */
export function toggleInlineMark(marker: string): MarkdownTransform {
  const len = marker.length
  return (state) =>
    state.changeByRange((range) => {
      let { from, to } = range

      if (from === to) {
        const line = state.doc.lineAt(from)
        const offset = from - line.from
        const before = WORD_RE_BEFORE.exec(line.text.slice(0, offset))
        const after = WORD_RE_AFTER.exec(line.text.slice(offset))
        if (before || after) {
          from -= before?.[0].length ?? 0
          to += after?.[0].length ?? 0
        }
      }

      const outerFrom = from - len
      const outerTo = to + len
      if (
        outerFrom >= 0 &&
        outerTo <= state.doc.length &&
        state.sliceDoc(outerFrom, from) === marker &&
        state.sliceDoc(to, outerTo) === marker
      ) {
        return {
          changes: [
            { from: outerFrom, to: from },
            { from: to, to: outerTo },
          ],
          range: EditorSelection.range(outerFrom, to - len),
        }
      }

      const selected = state.sliceDoc(from, to)
      if (
        selected.length > 2 * len &&
        selected.startsWith(marker) &&
        selected.endsWith(marker)
      ) {
        return {
          changes: [
            { from, to: from + len },
            { from: to - len, to },
          ],
          range: EditorSelection.range(from, to - 2 * len),
        }
      }

      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: EditorSelection.range(from + len, to + len),
      }
    })
}

/**
 * Réécrire les lignes que la sélection principale touche.
 *
 * La sélection *principale* seulement : CodeMirror gère plusieurs curseurs,
 * mais deux curseurs sur la même ligne produiraient deux réécritures qui se
 * chevauchent, et un `> ` posé deux fois. Les commandes de ligne ne sont
 * atteignables que depuis la barre d'outils, qui n'a qu'un bouton.
 *
 * La sélection résultante couvre le bloc réécrit, pour qu'un second clic sur
 * le même bouton le remette dans son état d'origine. Sur un curseur seul,
 * elle se replie en fin de ligne — la position d'où l'on continue à écrire.
 */
function transformLines(
  state: EditorState,
  rewrite: (lines: Array<string>) => Array<string>
): TransactionSpec {
  const { from, to, empty } = state.selection.main
  const first = state.doc.lineAt(from)
  const last = state.doc.lineAt(to)

  const lines: Array<string> = []
  for (let number = first.number; number <= last.number; number++) {
    lines.push(state.doc.line(number).text)
  }

  const insert = rewrite(lines).join("\n")
  const anchor = first.from + insert.length
  return {
    changes: { from: first.from, to: last.to, insert },
    selection: empty
      ? { anchor }
      : { anchor: first.from, head: first.from + insert.length },
  }
}

/**
 * Poser le niveau de titre demandé, ou l'enlever s'il y est déjà.
 *
 * Un titre remplace toujours celui qui était là : `# ` puis `## ` donne un
 * `## `, jamais `### `. Les dièses accumulés sont l'accident classique d'une
 * barre d'outils qui se contente de préfixer.
 */
export function toggleHeading(level: 1 | 2 | 3 | 4 | 5 | 6): MarkdownTransform {
  const prefix = `${"#".repeat(level)} `
  return (state) =>
    transformLines(state, (lines) => {
      const alreadyAtLevel = lines.every((line) => line.startsWith(prefix))
      return lines.map((line) => {
        const bare = line.replace(HEADING_RE, "")
        return alreadyAtLevel ? bare : prefix + bare
      })
    })
}

/** Citer les lignes, ou les dé-citer si elles le sont toutes déjà. */
export function toggleQuote(): MarkdownTransform {
  return (state) =>
    transformLines(state, (lines) => {
      const quoted = lines.every((line) => QUOTE_RE.test(line))
      return lines.map((line) =>
        quoted ? line.replace(QUOTE_RE, "") : `> ${line}`
      )
    })
}

/**
 * Basculer entre liste à puces et texte simple.
 *
 * Une liste numérotée devient une liste à puces plutôt que de recevoir un
 * second marqueur — les deux boutons décrivent le même emplacement.
 * L'indentation d'origine est conservée : c'est elle qui porte
 * l'imbrication.
 */
export function toggleBulletList(): MarkdownTransform {
  return (state) =>
    transformLines(state, (lines) => {
      const bulleted = lines.every((line) => BULLET_RE.test(line))
      return lines.map((line) => {
        if (bulleted) return line.replace(BULLET_RE, "$1")
        const bare = line.replace(BULLET_RE, "$1").replace(ORDERED_RE, "$1")
        const indent = /^[ \t]*/.exec(bare)?.[0] ?? ""
        return `${indent}- ${bare.slice(indent.length)}`
      })
    })
}

/**
 * Basculer entre liste numérotée et texte simple.
 *
 * La numérotation est réécrite de 1 à n plutôt que reprise : c'est la seule
 * façon qu'un ajout au milieu ne laisse pas deux « 3. » à la suite.
 */
export function toggleOrderedList(): MarkdownTransform {
  return (state) =>
    transformLines(state, (lines) => {
      const numbered = lines.every((line) => ORDERED_RE.test(line))
      return lines.map((line, index) => {
        if (numbered) return line.replace(ORDERED_RE, "$1")
        const bare = line.replace(BULLET_RE, "$1").replace(ORDERED_RE, "$1")
        const indent = /^[ \t]*/.exec(bare)?.[0] ?? ""
        return `${indent}${index + 1}. ${bare.slice(indent.length)}`
      })
    })
}

/**
 * Envelopper les lignes dans une clôture, ou la retirer.
 *
 * Le langage n'est pas deviné : `renderMarkdown` transmet la classe
 * `language-…` au HTML et une supposition fausse est pire qu'une absence.
 * La clôture ouvrante est laissée nue, prête à être complétée.
 */
export function toggleCodeBlock(): MarkdownTransform {
  return (state) =>
    transformLines(state, (lines) => {
      const first = lines[0] ?? ""
      const last = lines[lines.length - 1] ?? ""
      if (lines.length >= 2 && FENCE_RE.test(first) && FENCE_RE.test(last)) {
        return lines.slice(1, -1)
      }
      return ["```", ...lines, "```"]
    })
}

/**
 * Insérer un lien autour de la sélection.
 *
 * Deux orientations, parce qu'on colle aussi bien un libellé qu'une URL :
 * une sélection qui ressemble à une URL devient la cible et c'est le
 * libellé qui reste à écrire ; sinon la sélection devient le libellé et
 * c'est l'URL qui est sélectionnée. Dans les deux cas la partie à remplacer
 * ressort *sélectionnée*, pour qu'il n'y ait qu'à taper par-dessus.
 */
export function insertLink(placeholder = "texte du lien"): MarkdownTransform {
  return (state) =>
    state.changeByRange((range) => {
      const selected = state.sliceDoc(range.from, range.to)

      if (URL_RE.test(selected)) {
        const insert = `[${placeholder}](${selected})`
        return {
          changes: { from: range.from, to: range.to, insert },
          range: EditorSelection.range(
            range.from + 1,
            range.from + 1 + placeholder.length
          ),
        }
      }

      const label = selected || placeholder
      const insert = `[${label}](https://)`
      const target = range.from + label.length + 3
      return {
        changes: { from: range.from, to: range.to, insert },
        range: selected
          ? EditorSelection.range(target, target + "https://".length)
          : EditorSelection.range(
              range.from + 1,
              range.from + 1 + label.length
            ),
      }
    })
}

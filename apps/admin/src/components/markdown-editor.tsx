import { useCallback, useEffect, useMemo, useRef } from "react"
import { Compartment, EditorState } from "@codemirror/state"
import {
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { tags } from "@lezer/highlight"
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  SquareCode,
  TextQuote,
} from "lucide-react"
import type { ReactNode } from "react"
import type { MarkdownTransform } from "@/lib/markdown-commands"
import {
  insertLink,
  toggleBulletList,
  toggleCodeBlock,
  toggleHeading,
  toggleInlineMark,
  toggleOrderedList,
  toggleQuote,
} from "@/lib/markdown-commands"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// L'éditeur du corps d'un article.
//
// `value` est du Markdown, `onChange` rend du Markdown, et entre les deux
// il n'y a rien : le document de CodeMirror *est* cette chaîne. Pas de
// modèle de document intermédiaire, donc pas de re-sérialisation, donc
// aucun moyen que l'éditeur réécrive une partie du texte que personne n'a
// touchée. `markdown-editor.roundtrip.test.ts` mesure la propriété et
// explique ce que les éditeurs WYSIWYG candidats perdaient à sa place.
//
// Trois choses en dépendent, et c'est ce qui a tranché :
//   - `apps/web` rend ce champ par `renderMarkdown` ;
//   - le nettoyeur (`sanitize-html`) suppose du Markdown, rendu *puis*
//     nettoyé ;
//   - un agent doit pouvoir lire et réécrire le champ comme du texte.
//
// Conséquence assumée : la source Markdown n'est jamais masquée. Il n'y a
// pas de bascule « source / WYSIWYG » parce qu'il n'y a pas de second mode
// à quitter — ce que l'on voit est ce qui part dans Convex, caractère pour
// caractère.

/**
 * La coloration syntaxique.
 *
 * Les couleurs sont prises aux jetons du thème (`--primary`,
 * `--muted-foreground`) plutôt que fixées, pour que l'éditeur suive le mode
 * sombre comme le reste du tableau de bord. `processingInstruction` — les
 * `#`, `-`, `*`, `>` eux-mêmes — passe en gris atténué : la ponctuation
 * Markdown reste lisible sans concurrencer le texte qu'elle décore.
 */
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.25em", fontWeight: "600" },
  { tag: tags.heading2, fontSize: "1.15em", fontWeight: "600" },
  { tag: tags.heading3, fontSize: "1.05em", fontWeight: "600" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "600" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--primary)" },
  { tag: tags.url, color: "var(--primary)", textDecoration: "underline" },
  {
    tag: tags.monospace,
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    color: "var(--muted-foreground)",
  },
  { tag: tags.quote, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: tags.list, color: "var(--primary)" },
  { tag: tags.contentSeparator, color: "var(--muted-foreground)" },
  { tag: tags.processingInstruction, color: "var(--muted-foreground)" },
])

/**
 * L'habillage, en jetons du thème plutôt qu'en couleurs.
 *
 * `backgroundColor: transparent` sur la racine : c'est le conteneur qui
 * porte le fond et la bordure, comme les autres champs du formulaire, pour
 * que l'éditeur se pose dans une carte sans se distinguer d'un `Textarea`.
 */
const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--foreground)",
    fontSize: "0.875rem",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.7",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "0.75rem",
    caretColor: "var(--foreground)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklch, var(--primary) 22%, transparent)",
  },
})

/**
 * Un bouton de la barre d'outils.
 *
 * `type="button"` explicitement : le composant est destiné à vivre dans un
 * `<form>`, et un bouton sans type y soumet le formulaire — un « mettre en
 * gras » qui enregistre l'article est le genre de bug qu'on ne trouve
 * qu'une fois le contenu perdu.
 */
function ToolbarButton({
  label,
  shortcut,
  icon,
  disabled,
  onActivate,
}: {
  label: string
  shortcut?: string
  icon: ReactNode
  disabled?: boolean
  onActivate: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            // `onMouseDown` avec `preventDefault` plutôt que `onClick` :
            // sans cela le clic retire le focus de l'éditeur, la sélection
            // s'effondre, et la commande s'applique à un curseur vide.
            onMouseDown={(event) => event.preventDefault()}
            onClick={onActivate}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut ? (
          <span className="text-background/70">{shortcut}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

export function MarkdownEditor({
  value,
  onChange,
  disabled = false,
  maxLength,
  id,
}: {
  /** Le Markdown stocké dans `posts.body`. */
  value: string
  /** Reçoit le Markdown, jamais du HTML ni un modèle de document. */
  onChange: (markdown: string) => void
  disabled?: boolean
  /** `MAX_POST_BODY_LENGTH`, tel que `posts.update` l'applique. */
  maxLength: number
  /** Posé sur la zone de saisie, pour `aria-describedby` et le libellé. */
  id: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  // L'écouteur de CodeMirror est installé une fois pour toutes ; sans ce
  // relais il appellerait éternellement le `onChange` du premier rendu.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const editableCompartment = useMemo(() => new Compartment(), [])

  /** Appliquer une commande et rendre le focus, comme le ferait une frappe. */
  const run = useCallback((transform: MarkdownTransform) => {
    const view = viewRef.current
    if (!view || view.state.readOnly) return
    view.dispatch(transform(view.state))
    view.focus()
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          // `markdown()` installe son propre keymap : `Entrée` prolonge une
          // liste ou une citation, `Retour arrière` défait le marqueur. Ce
          // sont les deux gestes qui font la différence entre écrire du
          // Markdown et le composer à la main.
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(markdownHighlight),
          EditorView.lineWrapping,
          cmPlaceholder("Rédigez l'article en Markdown…"),
          editorTheme,
          keymap.of([
            {
              key: "Mod-b",
              run: (target) => {
                target.dispatch(toggleInlineMark("**")(target.state))
                return true
              },
            },
            {
              key: "Mod-i",
              run: (target) => {
                target.dispatch(toggleInlineMark("*")(target.state))
                return true
              },
            },
            {
              key: "Mod-k",
              run: (target) => {
                target.dispatch(insertLink()(target.state))
                return true
              },
            },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          editableCompartment.of([
            EditorState.readOnly.of(disabled),
            EditorView.editable.of(!disabled),
          ]),
          EditorView.contentAttributes.of({
            id,
            role: "textbox",
            "aria-multiline": "true",
            "aria-label": "Corps de l'article, en Markdown",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString())
            }
          }),
        ],
      }),
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Volontairement monté une seule fois, dépendances vides : `value` et
    // `disabled` sont réconciliés par les effets ci-dessous. Reconstruire la
    // vue à chaque frappe perdrait l'historique d'annulation et la position
    // du curseur. `id` est lu au montage seulement — c'est l'identifiant
    // d'un champ de formulaire, il ne change pas en cours de vie.
  }, [])

  // La réconciliation du composant contrôlé.
  //
  // Le remplacement n'a lieu que si le document diffère réellement : une
  // frappe fait `onChange` → état du parent → `value` identique au
  // document, et re-dispatcher ici remettrait le curseur à zéro à chaque
  // caractère. La sélection est reportée par bornage plutôt que perdue,
  // pour le cas d'un `value` réécrit de l'extérieur (chargement, annulation
  // du formulaire).
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    const { anchor, head } = view.state.selection.main
    const clamp = (position: number) => Math.min(position, value.length)
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: clamp(anchor), head: clamp(head) },
    })
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: editableCompartment.reconfigure([
        EditorState.readOnly.of(disabled),
        EditorView.editable.of(!disabled),
      ]),
    })
  }, [disabled, editableCompartment])

  const length = value.length
  const overLimit = length > maxLength
  const counterId = `${id}-counter`

  return (
    <div
      data-slot="markdown-editor"
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-input bg-transparent shadow-xs transition-[color,box-shadow]",
        "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        overLimit &&
          "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <TooltipProvider>
        <div
          role="toolbar"
          aria-label="Mise en forme"
          aria-controls={id}
          className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-1.5 py-1"
        >
          <ToolbarButton
            label="Gras"
            shortcut="⌘B"
            icon={<Bold />}
            disabled={disabled}
            onActivate={() => run(toggleInlineMark("**"))}
          />
          <ToolbarButton
            label="Italique"
            shortcut="⌘I"
            icon={<Italic />}
            disabled={disabled}
            onActivate={() => run(toggleInlineMark("*"))}
          />
          <ToolbarButton
            label="Code inline"
            icon={<Code />}
            disabled={disabled}
            onActivate={() => run(toggleInlineMark("`"))}
          />

          <Separator orientation="vertical" className="mx-1 h-5" />

          {/* Pas de `H1` : le gabarit de l'article rend déjà `post.title`
              en `<h1>` (`apps/web/src/pages/blog/[slug].astro`), et un
              second `<h1>` dans le corps casse la hiérarchie sur laquelle
              vivent le SEO et le résumé GEO. */}
          <ToolbarButton
            label="Titre de section"
            icon={<Heading2 />}
            disabled={disabled}
            onActivate={() => run(toggleHeading(2))}
          />
          <ToolbarButton
            label="Sous-titre"
            icon={<Heading3 />}
            disabled={disabled}
            onActivate={() => run(toggleHeading(3))}
          />

          <Separator orientation="vertical" className="mx-1 h-5" />

          <ToolbarButton
            label="Liste à puces"
            icon={<List />}
            disabled={disabled}
            onActivate={() => run(toggleBulletList())}
          />
          <ToolbarButton
            label="Liste numérotée"
            icon={<ListOrdered />}
            disabled={disabled}
            onActivate={() => run(toggleOrderedList())}
          />
          <ToolbarButton
            label="Citation"
            icon={<TextQuote />}
            disabled={disabled}
            onActivate={() => run(toggleQuote())}
          />
          <ToolbarButton
            label="Bloc de code"
            icon={<SquareCode />}
            disabled={disabled}
            onActivate={() => run(toggleCodeBlock())}
          />

          <Separator orientation="vertical" className="mx-1 h-5" />

          <ToolbarButton
            label="Lien"
            shortcut="⌘K"
            icon={<Link2 />}
            disabled={disabled}
            onActivate={() => run(insertLink())}
          />
        </div>
      </TooltipProvider>

      <div
        ref={hostRef}
        aria-describedby={counterId}
        className="max-h-[32rem] min-h-64 overflow-auto"
      />

      <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 px-3 py-1.5">
        <span className="text-xs text-muted-foreground">Markdown</span>
        {/* `polite` : le compteur change à chaque frappe, et une région
            assertive interromprait la personne au milieu d'un mot. Le
            dépassement n'est pas bloqué — c'est `posts.update` qui refuse,
            et tronquer un collage en silence coûterait plus cher qu'un
            refus visible. */}
        <span
          id={counterId}
          aria-live="polite"
          className={cn(
            "text-xs tabular-nums",
            overLimit ? "font-medium text-destructive" : "text-muted-foreground"
          )}
        >
          {length.toLocaleString("fr-FR")} / {maxLength.toLocaleString("fr-FR")}{" "}
          caractères
          {overLimit ? " — au-delà de la limite" : ""}
        </span>
      </div>
    </div>
  )
}

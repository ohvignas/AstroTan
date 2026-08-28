import { useCallback, useEffect, useRef, useState } from "react"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Image as ImageExtension } from "@tiptap/extension-image"
import { Placeholder } from "@tiptap/extensions"
import {
  Bold,
  Code,
  CodeXml,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Redo2,
  SquareCode,
  Strikethrough,
  TextQuote,
  Undo2,
  Unlink,
} from "lucide-react"
import type { Editor } from "@tiptap/react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// L'éditeur du corps d'un article — WYSIWYG, et sans conversion.
//
// `posts.body` contient du HTML : c'est la sortie native de Tiptap, celle
// que ProseMirror sérialise depuis son propre document. Il n'y a donc pas
// d'étape de conversion, et pas de perte à mesurer — les mesures faites
// auparavant portaient sur la re-sérialisation *vers du Markdown*, où le
// modèle de document n'a nulle part où ranger « cette puce était un `-` »
// ou « ce lien avait un titre ». En HTML, ces informations n'existent pas :
// une puce est un `<li>`, un lien est un `<a href>`.
//
// Ce que le site public lit reste identique — `<h2>`, `<p>`, `<ul>`,
// `<a>`, `<img alt>` — et `apps/web/src/lib/markdown.ts` nettoie toujours
// avant de servir. L'ensemble des nœuds activés ci-dessous est un
// sous-ensemble strict de son `ALLOWED_TAGS` : rien de ce que cet éditeur
// produit n'est retiré en silence à la publication.
//
// La bascule « source » est l'issue de secours : elle montre la chaîne
// exacte qui part dans Convex, et permet de la corriger à la main quand la
// vue riche fait quelque chose d'inattendu.

/**
 * Le HTML tel qu'il sera stocké.
 *
 * Un document Tiptap vide se sérialise en `<p></p>` — sept caractères qui
 * feraient passer un article jamais écrit pour un article vide mais
 * existant, compteraient dans la limite, et marqueraient le formulaire
 * modifié au simple chargement. Le vide est représenté par la chaîne vide,
 * des deux côtés de l'aller-retour.
 */
export function readHtml(editor: Editor): string {
  return editor.isEmpty ? "" : editor.getHTML()
}

/**
 * Le jeu de nœuds du corps d'un article.
 *
 * Exporté, et construit à la demande plutôt que partagé : le test monte un
 * éditeur sans interface pour mesurer l'aller-retour, et il ne mesurerait
 * rien s'il le faisait sur une autre configuration que celle-ci. Une
 * extension Tiptap porte de l'état lié à son éditeur, d'où la fonction.
 */
export function postBodyExtensions() {
  return [
    StarterKit.configure({
      // Les niveaux de titre ne sont pas restreints à `[2, 3]` alors que
      // la barre d'outils n'expose que ceux-là. Un corps venu de la
      // migration Markdown peut contenir un `<h1>` ou un `<h4>` : un
      // niveau non déclaré serait rétrogradé en paragraphe au simple
      // chargement, sans qu'on ait rien édité. On accepte de lire ce
      // qu'on ne propose pas d'écrire.
      heading: {},
      link: {
        // Sinon un clic dans l'éditeur quitte le tableau de bord.
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        // Le même jeu que `sanitize-html` accepte côté site
        // (`allowedSchemes`) : un lien que l'éditeur laisse écrire et que
        // la publication retire est une perte silencieuse.
        protocols: ["http", "https", "mailto", "tel"],
        // Tiptap pose `target="_blank"` et `rel="…nofollow"` par défaut sur
        // *tous* les liens. `target: null` les retire : un lien interne
        // vers un autre article n'a aucune raison d'ouvrir un onglet, et
        // c'est le gabarit du site qui décide, pas l'éditeur. `nofollow`
        // sur un lien interne coûterait du référencement pour rien ; le
        // `rel` conservé est exactement celui que `sanitize-html` réimpose
        // de toute façon à la publication.
        HTMLAttributes: { target: null, rel: "noopener noreferrer" },
      },
    }),
    // `inline: true` : le nœud image de bloc casse
    // `[![img](url)](url)` et colle l'image sur le bloc voisin. En inline,
    // l'image vit dans un paragraphe, comme en HTML.
    ImageExtension.configure({ inline: true }),
    Placeholder.configure({ placeholder: "Rédigez l'article…" }),
  ]
}

/**
 * Un bouton de la barre d'outils.
 *
 * `type="button"` explicitement : le composant vit dans un `<form>`, et un
 * bouton sans type y soumet le formulaire — un « mettre en gras » qui
 * enregistre l'article est le genre de bug qu'on ne trouve qu'une fois le
 * contenu perdu.
 */
function ToolbarButton({
  label,
  shortcut,
  icon,
  active = false,
  disabled,
  onActivate,
}: {
  label: string
  shortcut?: string
  icon: ReactNode
  active?: boolean
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
            aria-pressed={active}
            disabled={disabled}
            className={cn(active && "bg-muted text-foreground")}
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
          <span className="text-background/70"> {shortcut}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** L'habillage du contenu, en jetons du thème plutôt qu'en couleurs. */
const CONTENT_CLASS = cn(
  "[&_.tiptap]:min-h-64 [&_.tiptap]:px-3 [&_.tiptap]:py-2.5 [&_.tiptap]:text-sm [&_.tiptap]:leading-7 [&_.tiptap]:outline-none",
  // Le repère de saisie, posé par `Placeholder` sur le premier nœud vide.
  "[&_.tiptap_p.is-editor-empty:first-child]:before:pointer-events-none [&_.tiptap_p.is-editor-empty:first-child]:before:float-left [&_.tiptap_p.is-editor-empty:first-child]:before:h-0 [&_.tiptap_p.is-editor-empty:first-child]:before:text-muted-foreground [&_.tiptap_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
  "[&_.tiptap_p]:my-3",
  "[&_.tiptap_h1]:mt-6 [&_.tiptap_h1]:mb-3 [&_.tiptap_h1]:text-2xl [&_.tiptap_h1]:font-semibold",
  "[&_.tiptap_h2]:mt-6 [&_.tiptap_h2]:mb-3 [&_.tiptap_h2]:text-xl [&_.tiptap_h2]:font-semibold",
  "[&_.tiptap_h3]:mt-5 [&_.tiptap_h3]:mb-2 [&_.tiptap_h3]:text-base [&_.tiptap_h3]:font-semibold",
  "[&_.tiptap_h4]:mt-4 [&_.tiptap_h4]:mb-2 [&_.tiptap_h4]:font-semibold",
  "[&_.tiptap_ul]:my-3 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-6",
  "[&_.tiptap_ol]:my-3 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-6",
  "[&_.tiptap_li]:my-1 [&_.tiptap_li>p]:my-0",
  "[&_.tiptap_blockquote]:my-3 [&_.tiptap_blockquote]:border-l-2 [&_.tiptap_blockquote]:border-border [&_.tiptap_blockquote]:pl-3 [&_.tiptap_blockquote]:text-muted-foreground",
  "[&_.tiptap_code]:rounded [&_.tiptap_code]:bg-muted [&_.tiptap_code]:px-1 [&_.tiptap_code]:py-0.5 [&_.tiptap_code]:font-mono [&_.tiptap_code]:text-[0.85em]",
  "[&_.tiptap_pre]:my-3 [&_.tiptap_pre]:overflow-x-auto [&_.tiptap_pre]:rounded-lg [&_.tiptap_pre]:bg-muted [&_.tiptap_pre]:p-3 [&_.tiptap_pre]:font-mono [&_.tiptap_pre]:text-xs",
  "[&_.tiptap_pre_code]:bg-transparent [&_.tiptap_pre_code]:p-0",
  "[&_.tiptap_hr]:my-6 [&_.tiptap_hr]:border-border",
  "[&_.tiptap_a]:text-primary [&_.tiptap_a]:underline [&_.tiptap_a]:underline-offset-2",
  "[&_.tiptap_img]:my-1 [&_.tiptap_img]:inline-block [&_.tiptap_img]:max-w-full [&_.tiptap_img]:rounded-md",
  "[&_.tiptap_img.ProseMirror-selectednode]:outline [&_.tiptap_img.ProseMirror-selectednode]:outline-2 [&_.tiptap_img.ProseMirror-selectednode]:outline-primary"
)

export function RichTextEditor({
  value,
  onChange,
  disabled = false,
  maxLength,
  id,
}: {
  /** Le HTML stocké dans `posts.body`. */
  value: string
  /** Reçoit le HTML — la sortie native de Tiptap, sans conversion. */
  onChange: (html: string) => void
  disabled?: boolean
  /** `MAX_POST_BODY_LENGTH`, tel que `posts.update` l'applique. */
  maxLength: number
  /** Posé sur la zone de saisie, pour `aria-describedby` et le libellé. */
  id: string
}) {
  const [sourceMode, setSourceMode] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkHref, setLinkHref] = useState("")
  const [imageOpen, setImageOpen] = useState(false)
  const [imageSrc, setImageSrc] = useState("")
  const [imageAlt, setImageAlt] = useState("")

  // L'écouteur de Tiptap est installé une fois pour toutes ; sans ce relais
  // il appellerait éternellement le `onChange` du premier rendu.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // `Mod-k` est lu par `handleKeyDown`, qui est installé au montage : le
  // raccourci passe par une référence plutôt que par la fermeture du
  // premier rendu.
  const openLinkRef = useRef<() => void>(() => {})

  const editor = useEditor({
    // L'application est rendue côté serveur par TanStack Start ; monter
    // ProseMirror pendant le premier rendu y échouerait faute de DOM, et
    // désynchroniserait l'hydratation.
    immediatelyRender: false,
    editable: !disabled,
    extensions: postBodyExtensions(),
    content: value,
    editorProps: {
      attributes: {
        id,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Corps de l'article",
      },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          event.preventDefault()
          openLinkRef.current()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: updated }) => {
      onChangeRef.current(readHtml(updated))
    },
  })

  /** L'état que la barre d'outils affiche, recalculé à chaque transaction. */
  const toolbar = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            strike: current.isActive("strike"),
            code: current.isActive("code"),
            h2: current.isActive("heading", { level: 2 }),
            h3: current.isActive("heading", { level: 3 }),
            bulletList: current.isActive("bulletList"),
            orderedList: current.isActive("orderedList"),
            blockquote: current.isActive("blockquote"),
            codeBlock: current.isActive("codeBlock"),
            link: current.isActive("link"),
            canUndo: current.can().undo(),
            canRedo: current.can().redo(),
          }
        : null,
  })

  // La réconciliation du composant contrôlé.
  //
  // Le remplacement n'a lieu que si le HTML diffère réellement : une frappe
  // fait `onUpdate` → état du parent → `value` identique à la sortie de
  // l'éditeur, et re-`setContent` ici remettrait le curseur à zéro à chaque
  // caractère. `emitUpdate: false` évite en plus la boucle
  // `setContent` → `onUpdate` → `onChange`.
  useEffect(() => {
    if (!editor) return
    if (readHtml(editor) === value) return
    editor.commands.setContent(value, { emitUpdate: false })
  }, [editor, value])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  const openLinkDialog = useCallback(() => {
    if (!editor) return
    const href: unknown = editor.getAttributes("link").href
    setLinkHref(typeof href === "string" ? href : "")
    setLinkOpen(true)
  }, [editor])

  useEffect(() => {
    openLinkRef.current = openLinkDialog
  }, [openLinkDialog])

  const applyLink = useCallback(() => {
    if (!editor) return
    const href = linkHref.trim()
    const chain = editor.chain().focus().extendMarkRange("link")
    // Un champ vidé vaut « retirer le lien » : c'est le geste qu'on fait
    // spontanément, et il n'a aucun autre sens.
    if (href === "") chain.unsetLink().run()
    else chain.setLink({ href }).run()
    setLinkOpen(false)
  }, [editor, linkHref])

  const removeLink = useCallback(() => {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run()
  }, [editor])

  const openImageDialog = useCallback(() => {
    setImageSrc("")
    setImageAlt("")
    setImageOpen(true)
  }, [])

  const applyImage = useCallback(() => {
    if (!editor) return
    const src = imageSrc.trim()
    if (src === "") return
    editor.chain().focus().setImage({ src, alt: imageAlt.trim() }).run()
    setImageOpen(false)
  }, [editor, imageAlt, imageSrc])

  const run = useCallback(
    (command: (chain: ReturnType<Editor["chain"]>) => void) => {
      if (!editor || !editor.isEditable) return
      command(editor.chain().focus())
    },
    [editor]
  )

  const length = value.length
  const overLimit = length > maxLength
  const counterId = `${id}-counter`
  const sourceId = `${id}-source`
  const busy = disabled || !editor
  const formatDisabled = busy || sourceMode

  return (
    <div
      data-slot="rich-text-editor"
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
          aria-controls={sourceMode ? sourceId : id}
          className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-1.5 py-1"
        >
          <ToolbarButton
            label="Gras"
            shortcut="⌘B"
            icon={<Bold />}
            active={toolbar?.bold}
            disabled={formatDisabled}
            onActivate={() => run((chain) => chain.toggleBold().run())}
          />
          <ToolbarButton
            label="Italique"
            shortcut="⌘I"
            icon={<Italic />}
            active={toolbar?.italic}
            disabled={formatDisabled}
            onActivate={() => run((chain) => chain.toggleItalic().run())}
          />
          <ToolbarButton
            label="Barré"
            shortcut="⌘⇧S"
            icon={<Strikethrough />}
            active={toolbar?.strike}
            disabled={formatDisabled}
            onActivate={() => run((chain) => chain.toggleStrike().run())}
          />
          <ToolbarButton
            label="Code inline"
            shortcut="⌘E"
            icon={<Code />}
            active={toolbar?.code}
            disabled={formatDisabled}
            onActivate={() => run((chain) => chain.toggleCode().run())}
          />

          <Separator orientation="vertical" className="mx-1 h-5" />

          {/* Pas de `H1` : le gabarit de l'article rend déjà `post.title`
              en `<h1>` (`apps/web/src/pages/blog/[slug].astro`), et un
              second `<h1>` dans le corps casse la hiérarchie sur laquelle
              vivent le SEO et le résumé GEO. */}
          <ToolbarButton
            label="Titre de section"
            shortcut="⌘⌥2"
            icon={<Heading2 />}
            active={toolbar?.h2}
            disabled={formatDisabled}
            onActivate={() =>
              run((chain) => chain.toggleHeading({ level: 2 }).run())
            }
          />
          <ToolbarButton
            label="Sous-titre"
            shortcut="⌘⌥3"
            icon={<Heading3 />}
            active={toolbar?.h3}
            disabled={formatDisabled}
            onActivate={() =>
              run((chain) => chain.toggleHeading({ level: 3 }).run())
            }
          />

          <Separator orientation="vertical" className="mx-1 h-5" />

          <ToolbarButton
            label="Liste à puces"
            shortcut="⌘⇧8"
            icon={<List />}
            active={toolbar?.bulletList}
            disabled={formatDisabled}
            onActivate={() => run((chain) => chain.toggleBulletList().run())}
          />
          <ToolbarButton
            label="Liste numérotée"
            shortcut="⌘⇧7"
            icon={<ListOrdered />}
            active={toolbar?.orderedList}
            disabled={formatDisabled}
            onActivate={() => run((chain) => chain.toggleOrderedList().run())}
          />
          <ToolbarButton
            label="Citation"
            shortcut="⌘⇧B"
            icon={<TextQuote />}
            active={toolbar?.blockquote}
            disabled={formatDisabled}
            onActivate={() => run((chain) => chain.toggleBlockquote().run())}
          />
          <ToolbarButton
            label="Bloc de code"
            shortcut="⌘⌥C"
            icon={<SquareCode />}
            active={toolbar?.codeBlock}
            disabled={formatDisabled}
            onActivate={() => run((chain) => chain.toggleCodeBlock().run())}
          />
          <ToolbarButton
            label="Séparateur"
            icon={<Minus />}
            disabled={formatDisabled}
            onActivate={() => run((chain) => chain.setHorizontalRule().run())}
          />

          <Separator orientation="vertical" className="mx-1 h-5" />

          <ToolbarButton
            label={toolbar?.link ? "Modifier le lien" : "Lien"}
            shortcut="⌘K"
            icon={<Link2 />}
            active={toolbar?.link}
            disabled={formatDisabled}
            onActivate={openLinkDialog}
          />
          <ToolbarButton
            label="Retirer le lien"
            icon={<Unlink />}
            disabled={formatDisabled || !toolbar?.link}
            onActivate={removeLink}
          />
          <ToolbarButton
            label="Image"
            icon={<ImageIcon />}
            disabled={formatDisabled}
            onActivate={openImageDialog}
          />

          <Separator orientation="vertical" className="mx-1 h-5" />

          <ToolbarButton
            label="Annuler"
            shortcut="⌘Z"
            icon={<Undo2 />}
            disabled={formatDisabled || !toolbar?.canUndo}
            onActivate={() => run((chain) => chain.undo().run())}
          />
          <ToolbarButton
            label="Rétablir"
            shortcut="⌘⇧Z"
            icon={<Redo2 />}
            disabled={formatDisabled || !toolbar?.canRedo}
            onActivate={() => run((chain) => chain.redo().run())}
          />

          <div className="ms-auto">
            <ToolbarButton
              label={sourceMode ? "Vue enrichie" : "Voir le HTML"}
              icon={<CodeXml />}
              active={sourceMode}
              disabled={disabled}
              onActivate={() => setSourceMode((previous) => !previous)}
            />
          </div>
        </div>
      </TooltipProvider>

      {/* L'éditeur reste monté sous la vue source plutôt que démonté :
          reconstruire ProseMirror perdrait l'historique d'annulation et la
          position du curseur à chaque aller-retour. */}
      <div
        className={cn(
          "max-h-[70vh] overflow-y-auto",
          CONTENT_CLASS,
          sourceMode && "hidden"
        )}
        aria-describedby={counterId}
      >
        <EditorContent editor={editor} />
      </div>

      {sourceMode ? (
        <Textarea
          id={sourceId}
          aria-label="Corps de l'article, en HTML"
          aria-describedby={counterId}
          value={value}
          disabled={disabled}
          spellCheck={false}
          className="max-h-[70vh] min-h-64 rounded-none border-0 font-mono text-xs shadow-none focus-visible:ring-0"
          // Ce que l'on tape ici part tel quel dans Convex : la vue riche
          // se réaligne dessus par l'effet de réconciliation, jamais
          // l'inverse. Ouvrir puis refermer la vue source sans rien taper
          // ne modifie donc rien — si le HTML contenait quelque chose que
          // Tiptap ne sait pas représenter, il n'est réécrit qu'à la
          // première édition faite dans la vue riche.
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 px-3 py-1.5">
        <span className="text-xs text-muted-foreground">
          {sourceMode ? "HTML (source)" : "HTML"}
        </span>
        {/* `polite` : le compteur change à chaque frappe, et une région
            assertive interromprait la personne au milieu d'un mot. Le
            dépassement n'est pas bloqué — c'est `posts.update` qui refuse,
            et tronquer un collage en silence coûterait plus cher qu'un
            refus visible. Mesuré sur le HTML, puisque c'est la chaîne que
            la mutation borne. */}
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

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lien</DialogTitle>
            <DialogDescription>
              L'adresse appliquée au texte sélectionné. Vider le champ retire
              le lien.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`${id}-link-href`}>Adresse</FieldLabel>
            <Input
              id={`${id}-link-href`}
              value={linkHref}
              placeholder="https://exemple.fr/page"
              autoFocus
              onChange={(event) => setLinkHref(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                applyLink()
              }}
            />
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Annuler
            </DialogClose>
            <Button type="button" onClick={applyLink}>
              Appliquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={imageOpen} onOpenChange={setImageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Image</DialogTitle>
            <DialogDescription>
              L'adresse du fichier et son texte alternatif — celui que lisent
              les lecteurs d'écran et les moteurs.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`${id}-image-src`}>Adresse</FieldLabel>
            <Input
              id={`${id}-image-src`}
              value={imageSrc}
              placeholder="https://exemple.fr/image.webp"
              autoFocus
              onChange={(event) => setImageSrc(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-image-alt`}>
              Texte alternatif
            </FieldLabel>
            <Input
              id={`${id}-image-alt`}
              value={imageAlt}
              onChange={(event) => setImageAlt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                applyImage()
              }}
            />
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Annuler
            </DialogClose>
            <Button
              type="button"
              disabled={imageSrc.trim() === ""}
              onClick={applyImage}
            >
              Insérer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import {
  MAX_BLOCK_SUBTITLE_LENGTH,
  MAX_BLOCK_TITLE_LENGTH,
  MAX_CANONICAL_URL_LENGTH,
  MAX_CTA_HREF_LENGTH,
  MAX_CTA_LABEL_LENGTH,
  MAX_FAQ_ANSWER_LENGTH,
  MAX_FAQ_QUESTION_LENGTH,
  MAX_FEATURE_ITEM_BODY_LENGTH,
  MAX_FEATURE_ITEM_TITLE_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  MAX_RICH_TEXT_HTML_LENGTH,
  MAX_SEO_DESCRIPTION_LENGTH,
  MAX_SEO_TITLE_LENGTH,
  MAX_SLUG_LENGTH,
} from "@astrotan/backend/convex/blocks"
import {
  BLOCK_TYPES,
  BLOCK_TYPE_LABELS,
  createDefaultBlock,
} from "@/lib/pageBlocks"
import type { Block } from "@/lib/pageBlocks"
import { describePageError } from "@/lib/pageErrors"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  CheckIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"

export const Route = createFileRoute("/_authed/pages/$pageId")({
  component: PageEditorPage,
})

type Profile = FunctionReturnType<typeof api.profiles.me>
type PageDoc = NonNullable<FunctionReturnType<typeof api.pages.get>>
type PublicationStatus = FunctionReturnType<typeof api.pages.publicationStatus>

function PageEditorPage() {
  const { pageId } = Route.useParams()
  const id = pageId as Id<"pages">
  // Already subscribed by `AppShell`.
  const profile = useQuery(api.profiles.me)
  const page = useQuery(api.pages.get, { id })

  if (profile === undefined || page === undefined) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>
  }

  if (page === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Page introuvable</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <Link to="/pages" className="underline">
            Retour à la liste des pages
          </Link>
        </CardContent>
      </Card>
    )
  }

  // `key={page._id}` isn't needed here (the route only ever mounts one
  // page at a time), but the child's own local state (below) is seeded
  // exactly once from `page` on its first render — reactive updates to
  // `page` afterwards (a concurrent editor, or this screen's own `update`
  // call resolving) never blow away in-progress local edits.
  return <PageEditor page={page} profile={profile} />
}

function PageEditor({ page, profile }: { page: PageDoc; profile: Profile }) {
  const updatePage = useMutation(api.pages.update)
  const removePage = useMutation(api.pages.remove)
  const publishPage = useMutation(api.pages.publishPage)
  const unpublish = useMutation(api.pages.unpublish)
  const mintPreviewToken = useMutation(api.pages.mintPreviewToken)
  const publicationStatus = useQuery(api.pages.publicationStatus, {
    id: page._id,
  })

  const [title, setTitle] = useState(page.title)
  const [slug, setSlug] = useState(page.slug)
  const [blocks, setBlocks] = useState<Block[]>(page.blocks)
  const [seoTitle, setSeoTitle] = useState(page.seo?.title ?? "")
  const [seoDescription, setSeoDescription] = useState(
    page.seo?.description ?? ""
  )
  const [seoCanonicalUrl, setSeoCanonicalUrl] = useState(
    page.seo?.canonicalUrl ?? ""
  )
  const [seoNoindex, setSeoNoindex] = useState(page.seo?.noindex ?? false)

  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // The property this whole screen must uphold, verbatim: "hiding a
  // button is a courtesy to the operator, never the enforcement." Every
  // flag below only controls what *renders* — `pages.update`/`remove`
  // (`requireOwnDocument`) and `pages.publishPage`/`unpublish`
  // (`requireRole(["owner","admin"])`) re-check the exact same boundary
  // themselves, unconditionally, on the server.
  const isOwn = page.createdBy === profile.authUserId
  const canWrite = profile.role !== "editor" || isOwn
  const canPublish = profile.role === "owner" || profile.role === "admin"

  function addBlock(type: Block["type"]) {
    setBlocks((prev) => [...prev, createDefaultBlock(type)])
  }
  function removeBlock(index: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== index))
  }
  function moveBlock(index: number, direction: -1 | 1) {
    setBlocks((prev) => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      const [item] = next.splice(index, 1)
      if (item === undefined) return prev
      next.splice(target, 0, item)
      return next
    })
  }
  function updateBlock(index: number, next: Block) {
    setBlocks((prev) => prev.map((b, i) => (i === index ? next : b)))
  }

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      await updatePage({
        id: page._id,
        title,
        slug,
        blocks,
        seo: {
          title: seoTitle.trim() || undefined,
          description: seoDescription.trim() || undefined,
          canonicalUrl: seoCanonicalUrl.trim() || undefined,
          noindex: seoNoindex,
        },
      })
    } catch (err) {
      setError(describePageError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handlePublishToggle() {
    setError(null)
    setBusy(true)
    try {
      if (page.status === "published") {
        await unpublish({ id: page._id })
      } else {
        await publishPage({ id: page._id })
      }
    } catch (err) {
      setError(describePageError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handlePreview() {
    setError(null)
    setBusy(true)
    try {
      const { token } = await mintPreviewToken({ id: page._id })
      const base = import.meta.env.VITE_WEB_SITE_URL as string | undefined
      if (!base) {
        setError("VITE_WEB_SITE_URL n'est pas configuré côté admin.")
        return
      }
      const url = `${base}/preview/page/${page._id}?t=${encodeURIComponent(token)}`
      setPreviewUrl(url)
      window.open(url, "_blank", "noopener,noreferrer")
    } catch (err) {
      setError(describePageError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link to="/pages" />}
            nativeButton={false}
          >
            <ArrowLeftIcon />
          </Button>
          <div>
            <h1 className="text-lg font-medium">{page.title}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>/{page.slug}</span>
              <PublicationStatusBadge
                status={publicationStatus}
                pageStatus={page.status}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={handlePreview}
          >
            <ExternalLinkIcon data-icon="inline-start" />
            Prévisualiser
          </Button>
          {canPublish && (
            <Button
              variant={page.status === "published" ? "outline" : "default"}
              size="sm"
              disabled={busy}
              onClick={handlePublishToggle}
            >
              {page.status === "published" ? "Dépublier" : "Publier"}
            </Button>
          )}
          {(canPublish || isOwn) && (
            <DeletePageButton
              title={page.title}
              published={page.status === "published"}
              onConfirm={async () => {
                setError(null)
                setBusy(true)
                try {
                  await removePage({ id: page._id })
                  window.location.assign("/pages")
                } catch (err) {
                  setError(describePageError(err))
                  setBusy(false)
                }
              }}
            />
          )}
        </div>
      </div>

      {!canWrite && (
        <p className="rounded-lg border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Cette page appartient à un autre utilisateur : vous pouvez la
          consulter, pas la modifier.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {previewUrl && (
        <p className="text-xs text-muted-foreground">
          Le lien de prévisualisation expire dans 15 minutes.{" "}
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Rouvrir
          </a>
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Informations générales</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="edit-title">Titre</FieldLabel>
            <Input
              id="edit-title"
              value={title}
              maxLength={MAX_PAGE_TITLE_LENGTH}
              disabled={!canWrite}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-slug">Slug</FieldLabel>
            <Input
              id="edit-slug"
              value={slug}
              maxLength={MAX_SLUG_LENGTH}
              disabled={!canWrite}
              onChange={(event) => setSlug(event.target.value)}
            />
            <FieldDescription>
              Chemin public — sans slash de tête ni de fin.
            </FieldDescription>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SEO</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="seo-title">Titre SEO</FieldLabel>
            <Input
              id="seo-title"
              value={seoTitle}
              maxLength={MAX_SEO_TITLE_LENGTH}
              disabled={!canWrite}
              placeholder={page.title}
              onChange={(event) => setSeoTitle(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="seo-description">Description</FieldLabel>
            <Textarea
              id="seo-description"
              value={seoDescription}
              maxLength={MAX_SEO_DESCRIPTION_LENGTH}
              disabled={!canWrite}
              onChange={(event) => setSeoDescription(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="seo-canonical">URL canonique</FieldLabel>
            <Input
              id="seo-canonical"
              value={seoCanonicalUrl}
              maxLength={MAX_CANONICAL_URL_LENGTH}
              disabled={!canWrite}
              placeholder="https://…"
              onChange={(event) => setSeoCanonicalUrl(event.target.value)}
            />
          </Field>
          <Field orientation="horizontal">
            <Switch
              id="seo-noindex"
              checked={seoNoindex}
              disabled={!canWrite}
              onCheckedChange={(checked) => setSeoNoindex(checked === true)}
            />
            <FieldLabel htmlFor="seo-noindex">
              Exclure des moteurs de recherche (noindex)
            </FieldLabel>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Blocs</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {blocks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Aucun bloc — ajoutez-en un ci-dessous.
            </p>
          )}
          {blocks.map((block, index) => (
            <BlockCard
              key={index}
              block={block}
              index={index}
              total={blocks.length}
              disabled={!canWrite}
              onChange={(next) => updateBlock(index, next)}
              onRemove={() => removeBlock(index)}
              onMoveUp={() => moveBlock(index, -1)}
              onMoveDown={() => moveBlock(index, 1)}
            />
          ))}
          {canWrite && <AddBlockControl onAdd={addBlock} />}
        </CardContent>
      </Card>

      {canWrite && (
        <div className="flex justify-end">
          <Button disabled={saving} onClick={handleSave}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      )}
    </div>
  )
}

function DeletePageButton({
  title,
  published,
  onConfirm,
}: {
  title: string
  published: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
        <Trash2Icon data-icon="inline-start" />
        Supprimer
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer « {title} » ?</AlertDialogTitle>
          <AlertDialogDescription>
            {published
              ? "Cette page est publiée : elle disparaîtra du site public une fois l'invalidation propagée. Cette action est irréversible."
              : "Ce brouillon sera supprimé définitivement. Cette action est irréversible."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Supprimer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// The whole reason `revalidationOutbox` exists (this task's own brief,
// verbatim): "a publication that silently fails to propagate is the
// failure mode the outbox was built to make visible." `undefined` is the
// query still loading; `null` means `pages.get` above already refused
// (shouldn't happen once `page` itself resolved, kept exhaustive anyway).
function PublicationStatusBadge({
  status,
  pageStatus,
}: {
  status: PublicationStatus | undefined
  pageStatus: "draft" | "published"
}) {
  if (status === undefined) {
    return <Badge variant="outline">…</Badge>
  }
  if (status === null || status.state === "draft") {
    return <Badge variant="outline">Brouillon</Badge>
  }
  if (status.state === "published") {
    return (
      <Badge variant="default">
        <CheckIcon data-icon="inline-start" />
        Publiée
      </Badge>
    )
  }
  if (status.state === "propagating") {
    return (
      <Badge variant="secondary">
        <Loader2Icon data-icon="inline-start" className="animate-spin" />
        Propagation en cours ({status.attempts} tentative
        {status.attempts > 1 ? "s" : ""})
      </Badge>
    )
  }
  // "failed"
  return (
    <Badge variant="destructive" title={status.lastError ?? undefined}>
      <TriangleAlertIcon data-icon="inline-start" />
      Échec de la propagation
      {pageStatus === "published" ? "" : " (dernière tentative)"}
    </Badge>
  )
}

// ---------------------------------------------------------------------
// Block editor
// ---------------------------------------------------------------------

function BlockCard({
  block,
  index,
  total,
  disabled,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  block: Block
  index: number
  total: number
  disabled: boolean
  onChange: (block: Block) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  return (
    <div className="rounded-lg border border-input p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {index + 1}. {BLOCK_TYPE_LABELS[block.type]}
        </span>
        {!disabled && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={index === 0}
              onClick={onMoveUp}
              aria-label="Monter"
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={index === total - 1}
              onClick={onMoveDown}
              aria-label="Descendre"
            >
              <ArrowDownIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onRemove}
              aria-label="Supprimer le bloc"
            >
              <Trash2Icon />
            </Button>
          </div>
        )}
      </div>
      <BlockFields block={block} disabled={disabled} onChange={onChange} />
    </div>
  )
}

function BlockFields({
  block,
  disabled,
  onChange,
}: {
  block: Block
  disabled: boolean
  onChange: (block: Block) => void
}) {
  switch (block.type) {
    case "hero":
      return (
        <div className="flex flex-col gap-3">
          <LabeledInput
            label="Titre"
            value={block.title}
            max={MAX_BLOCK_TITLE_LENGTH}
            disabled={disabled}
            onChange={(title) => onChange({ ...block, title })}
          />
          <LabeledTextarea
            label="Sous-titre"
            value={block.subtitle ?? ""}
            max={MAX_BLOCK_SUBTITLE_LENGTH}
            disabled={disabled}
            onChange={(subtitle) =>
              onChange({ ...block, subtitle: subtitle || undefined })
            }
          />
          <OptionalCtaFields
            cta={block.cta}
            disabled={disabled}
            onChange={(cta) => onChange({ ...block, cta })}
          />
        </div>
      )
    case "richText":
      return (
        <LabeledTextarea
          label="HTML"
          value={block.html}
          max={MAX_RICH_TEXT_HTML_LENGTH}
          disabled={disabled}
          rows={6}
          onChange={(html) => onChange({ ...block, html })}
        />
      )
    case "features":
      return (
        <RepeatableItems
          items={block.items}
          disabled={disabled}
          addLabel="Ajouter une fonctionnalité"
          emptyItem={{ title: "", body: "" }}
          fields={[
            {
              key: "title",
              label: "Titre",
              max: MAX_FEATURE_ITEM_TITLE_LENGTH,
            },
            {
              key: "body",
              label: "Texte",
              max: MAX_FEATURE_ITEM_BODY_LENGTH,
              multiline: true,
            },
          ]}
          onChange={(items) => onChange({ ...block, items })}
        />
      )
    case "gallery":
      return (
        <p className="text-sm text-muted-foreground">
          Bloc galerie — la bibliothèque média n'est pas encore disponible dans
          cette version ; ce bloc peut être ajouté/réordonné/supprimé mais n'a
          pas encore d'images à éditer ici.
        </p>
      )
    case "faq":
      return (
        <RepeatableItems
          items={block.items}
          disabled={disabled}
          addLabel="Ajouter une question"
          emptyItem={{ question: "", answer: "" }}
          fields={[
            {
              key: "question",
              label: "Question",
              max: MAX_FAQ_QUESTION_LENGTH,
            },
            {
              key: "answer",
              label: "Réponse",
              max: MAX_FAQ_ANSWER_LENGTH,
              multiline: true,
            },
          ]}
          onChange={(items) => onChange({ ...block, items })}
        />
      )
    case "cta":
      return (
        <div className="flex flex-col gap-3">
          <LabeledInput
            label="Titre"
            value={block.title}
            max={MAX_BLOCK_TITLE_LENGTH}
            disabled={disabled}
            onChange={(title) => onChange({ ...block, title })}
          />
          <LabeledInput
            label="Texte du bouton"
            value={block.cta.label}
            max={MAX_CTA_LABEL_LENGTH}
            disabled={disabled}
            onChange={(label) =>
              onChange({ ...block, cta: { ...block.cta, label } })
            }
          />
          <LabeledInput
            label="Lien du bouton"
            value={block.cta.href}
            max={MAX_CTA_HREF_LENGTH}
            disabled={disabled}
            onChange={(href) =>
              onChange({ ...block, cta: { ...block.cta, href } })
            }
          />
        </div>
      )
    default: {
      const exhaustive: never = block
      throw new Error(`Unknown block type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

function OptionalCtaFields({
  cta,
  disabled,
  onChange,
}: {
  cta: { label: string; href: string } | undefined
  disabled: boolean
  onChange: (cta: { label: string; href: string } | undefined) => void
}) {
  const included = cta !== undefined
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-input p-2.5">
      <Field orientation="horizontal">
        <Switch
          checked={included}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange(checked === true ? { label: "", href: "" } : undefined)
          }
        />
        <FieldLabel>Inclure un bouton d'appel à l'action</FieldLabel>
      </Field>
      {included && (
        <>
          <LabeledInput
            label="Texte du bouton"
            value={cta.label}
            max={MAX_CTA_LABEL_LENGTH}
            disabled={disabled}
            onChange={(label) => onChange({ ...cta, label })}
          />
          <LabeledInput
            label="Lien du bouton"
            value={cta.href}
            max={MAX_CTA_HREF_LENGTH}
            disabled={disabled}
            onChange={(href) => onChange({ ...cta, href })}
          />
        </>
      )}
    </div>
  )
}

function LabeledInput({
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string
  value: string
  max: number
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        value={value}
        maxLength={max}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

function LabeledTextarea({
  label,
  value,
  max,
  disabled,
  rows,
  onChange,
}: {
  label: string
  value: string
  max: number
  disabled: boolean
  rows?: number
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Textarea
        value={value}
        maxLength={max}
        disabled={disabled}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

// Shared by `features.items` ({title, body}) and `faq.items` ({question,
// answer}) — both are a plain array of two bounded string fields, only
// the field names/labels/limits differ.
function RepeatableItems<T extends Record<string, string>>({
  items,
  disabled,
  addLabel,
  emptyItem,
  fields,
  onChange,
}: {
  items: T[]
  disabled: boolean
  addLabel: string
  emptyItem: T
  fields: { key: keyof T; label: string; max: number; multiline?: boolean }[]
  onChange: (items: T[]) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucun élément pour le moment.
        </p>
      )}
      {items.map((item, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-lg border border-dashed border-input p-2.5"
        >
          {fields.map((field) =>
            field.multiline ? (
              <LabeledTextarea
                key={String(field.key)}
                label={field.label}
                // `T extends Record<string, string>` guarantees every
                // value is a real string — `noUncheckedIndexedAccess`
                // still widens a *generic* key's indexed access to
                // `| undefined`, a known TS limitation around index
                // signatures rather than a real possibility here.
                value={item[field.key] as string}
                max={field.max}
                disabled={disabled}
                onChange={(value) =>
                  onChange(
                    items.map((it, i) =>
                      i === index ? { ...it, [field.key]: value } : it
                    )
                  )
                }
              />
            ) : (
              <LabeledInput
                key={String(field.key)}
                label={field.label}
                value={item[field.key] as string}
                max={field.max}
                disabled={disabled}
                onChange={(value) =>
                  onChange(
                    items.map((it, i) =>
                      i === index ? { ...it, [field.key]: value } : it
                    )
                  )
                }
              />
            )
          )}
          {!disabled && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                <Trash2Icon data-icon="inline-start" />
                Retirer
              </Button>
            </div>
          )}
        </div>
      ))}
      {!disabled && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...items, emptyItem])}
        >
          <PlusIcon data-icon="inline-start" />
          {addLabel}
        </Button>
      )}
    </div>
  )
}

function AddBlockControl({ onAdd }: { onAdd: (type: Block["type"]) => void }) {
  const [type, setType] = useState<Block["type"]>("richText")
  return (
    <div className="flex items-center gap-2 border-t border-input pt-3">
      <Select
        items={BLOCK_TYPE_LABELS}
        value={type}
        onValueChange={(v) => setType(v as Block["type"])}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BLOCK_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {BLOCK_TYPE_LABELS[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={() => onAdd(type)}>
        <PlusIcon data-icon="inline-start" />
        Ajouter un bloc
      </Button>
    </div>
  )
}

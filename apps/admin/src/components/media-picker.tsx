import { useEffect, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
// From `convex/content.ts`, never from `convex/media.ts`: `content` is a
// pure module (one `convex/values` import, no function definitions), while
// `media` reaches `_generated/server`, `_registry` and `lib/authz` →
// `auth.ts`. Importing the latter from a component drags the server into
// the browser bundle, which the Convex client reports once per function it
// finds — "Convex functions should not be imported in the browser. This
// will throw an error in future versions of `convex`."
import {
  ALLOWED_MIME_TYPES,
  MAX_ALT_LENGTH,
  MAX_FILENAME_LENGTH,
  MAX_MEDIA_SIZE_BYTES,
} from "@astrotan/backend/convex/content"
import { describeMediaError, formatFileSize } from "@/lib/media"
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ImageIcon, UploadIcon } from "lucide-react"

// The media library's shared pieces: the thumbnail, the upload dialog, the
// edit dialog and the picker. The library route
// (`routes/_authed/media.tsx`) and every screen that has to *choose* a file
// — the post editor's cover, a page's `seo.ogImageId` — render the same
// grid from the same query, so the grid lives here rather than in the route
// that happened to need it first.

export type MediaItem = FunctionReturnType<typeof api.media.list>[number]

const ACCEPTED_MIME_ATTRIBUTE = ALLOWED_MIME_TYPES.join(",")

/**
 * One file's preview tile.
 *
 * `alt` comes from the row, never from the filename: this grid is the one
 * place in the dashboard where the alternative text is visibly *used*, and
 * seeing it read back is what tells an operator whether theirs was any
 * good.
 */
export function MediaThumbnail({
  item,
  className,
}: {
  item: MediaItem
  className?: string
}) {
  if (item.url === null) {
    // `ctx.storage.getUrl` returns null for a storage id whose file is
    // gone. The row outliving its bytes is not something this grid can
    // fix, but it must not render a broken image either.
    return (
      <div
        className={cn(
          "flex aspect-video w-full items-center justify-center rounded-lg bg-muted text-muted-foreground",
          className
        )}
      >
        <ImageIcon />
      </div>
    )
  }

  return (
    <img
      src={item.url}
      alt={item.alt}
      // `width`/`height` are optional on the row (a file registered before
      // the browser could measure it, or an image format the browser
      // refused to decode), so they are spread only when present rather
      // than defaulted to a wrong number.
      {...(item.width !== undefined && item.height !== undefined
        ? { width: item.width, height: item.height }
        : {})}
      loading="lazy"
      className={cn(
        "aspect-video w-full rounded-lg bg-muted object-contain",
        className
      )}
    />
  )
}

// ---------------------------------------------------------------------
// Uploading
//
// Both the upload dialog and the "replace the image" half of the edit
// dialog run the same three steps against the same two bounds, so both
// live here once. `register` and `replaceFile` enforce those bounds
// server-side regardless; checking them in the browser only means the
// refusal arrives before ten megabytes go over the wire.
// ---------------------------------------------------------------------

/** An operator-facing refusal, or `null` when the file is acceptable. */
function describeRejectedFile(file: File): string | null {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return `Ce type de fichier (${file.type || "inconnu"}) n'est pas accepté. Formats autorisés : PNG, JPEG, WebP, AVIF, GIF.`
  }
  if (file.size > MAX_MEDIA_SIZE_BYTES) {
    return `Ce fichier est trop volumineux (maximum ${formatFileSize(MAX_MEDIA_SIZE_BYTES)}).`
  }
  return null
}

/**
 * The image's intrinsic size, measured in the browser before upload.
 *
 * Stored so a renderer can reserve the box before the bytes arrive — the
 * whole point of the optional `width`/`height` on the row. Failure is an
 * ordinary answer: a format this browser cannot decode still uploads, it
 * simply has no dimensions, exactly as the schema allows.
 */
function readImageDimensions(
  file: File
): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve({})
    }
    image.src = objectUrl
  })
}

/**
 * Put a file in storage and describe it.
 *
 * The bytes never pass through a mutation: Convex hands out a short-lived
 * URL, the browser POSTs straight to storage, and only the resulting id —
 * with the facts a mutation cannot work out for itself — comes back.
 */
async function uploadToStorage(
  generateUploadUrl: () => Promise<string>,
  file: File
): Promise<{
  storageId: Id<"_storage">
  mime: string
  size: number
  width?: number
  height?: number
}> {
  const dimensions = await readImageDimensions(file)
  const uploadUrl = await generateUploadUrl()
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  })
  if (!response.ok) {
    throw new Error(`upload failed with status ${response.status}`)
  }
  const { storageId } = (await response.json()) as {
    storageId: Id<"_storage">
  }
  return { storageId, mime: file.type, size: file.size, ...dimensions }
}

/**
 * Upload a file and register it in the library.
 *
 * `alt` is a required argument of this dialog's form, not a field an
 * operator can come back to: the mutation refuses an empty one with
 * `INVALID_ALT`, and a form that can reach that error has already failed —
 * an alt you are allowed to fill in later never gets filled in.
 */
export function UploadMediaDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploaded?: (storageId: Id<"_storage">) => void
}) {
  const generateUploadUrl = useMutation(api.media.generateUploadUrl)
  const register = useMutation(api.media.register)

  const [file, setFile] = useState<File | null>(null)
  const [alt, setAlt] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      setFile(null)
      setAlt("")
      setError(null)
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null
    setError(null)
    if (picked === null) {
      setFile(null)
      return
    }
    const rejection = describeRejectedFile(picked)
    if (rejection !== null) {
      setFile(null)
      setError(rejection)
      return
    }
    setFile(picked)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (file === null || alt.trim().length === 0) return
    setError(null)
    setSubmitting(true)
    try {
      const uploaded = await uploadToStorage(
        () => generateUploadUrl({}),
        file
      )
      await register({ ...uploaded, filename: file.name, alt })
      handleOpenChange(false)
      onUploaded?.(uploaded.storageId)
    } catch (err) {
      setError(describeMediaError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Téléverser une image</DialogTitle>
          <DialogDescription>
            PNG, JPEG, WebP, AVIF ou GIF, {formatFileSize(MAX_MEDIA_SIZE_BYTES)}{" "}
            au maximum.
          </DialogDescription>
        </DialogHeader>
        <form id="upload-media-form" onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="media-file">Fichier</FieldLabel>
              <Input
                id="media-file"
                type="file"
                required
                accept={ACCEPTED_MIME_ATTRIBUTE}
                onChange={handleFileChange}
              />
              {file && (
                <FieldDescription>
                  {file.name} — {formatFileSize(file.size)}
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="media-alt">
                Texte alternatif (obligatoire)
              </FieldLabel>
              <Input
                id="media-alt"
                autoComplete="off"
                required
                maxLength={MAX_ALT_LENGTH}
                placeholder="Vue du causse au lever du jour"
                value={alt}
                onChange={(event) => setAlt(event.target.value)}
              />
              <FieldDescription>
                Décrit l'image pour qui ne la voit pas. Exigé maintenant, pas
                plus tard : {alt.trim().length}/{MAX_ALT_LENGTH}.
              </FieldDescription>
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button
            type="submit"
            form="upload-media-form"
            disabled={submitting || file === null || alt.trim().length === 0}
          >
            {submitting ? "Téléversement…" : "Téléverser"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Edit a media item: its displayed name, its alt text, and the image
 * itself.
 *
 * One dialog rather than three, because those are the three things about a
 * library entry that can legitimately be wrong after the fact — a
 * misspelled filename, an alt written in a hurry, and a picture that has
 * simply been superseded. Replacing the file keeps the row and its id, so
 * every post cover and `seo.ogImageId` pointing at it follows the swap
 * instead of breaking; that is `media.replaceFile`'s whole job.
 *
 * The alt stays required here. "Required at upload" that can be emptied on
 * the next screen means "required once", and `media.update` refuses a blank
 * one server-side regardless of what this form allows.
 */
export function EditMediaDialog({
  item,
  open,
  onOpenChange,
  canReplaceFile = true,
}: {
  item: MediaItem
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Courtesy only. `media.replaceFile` calls `requireOwnDocument`, so an
   * editor swapping someone else's file is refused server-side; hiding the
   * field spares them a control that was only ever going to come back
   * refused. `media.update` has no such rule — renaming and re-describing
   * are open to all three roles.
   */
  canReplaceFile?: boolean
}) {
  const generateUploadUrl = useMutation(api.media.generateUploadUrl)
  const updateMedia = useMutation(api.media.update)
  const replaceFile = useMutation(api.media.replaceFile)

  const [filename, setFilename] = useState(item.filename)
  const [alt, setAlt] = useState(item.alt)
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seeded from `item` only when the dialog opens — `open` is the sole
  // dependency on purpose, and `item` deliberately is not. `api.media.list`
  // is a live subscription, so a concurrent edit (or this dialog's own
  // `update` resolving) hands down a new `item`; re-running on that would
  // overwrite whatever is being typed here mid-sentence.
  useEffect(() => {
    if (open) {
      setFilename(item.filename)
      setAlt(item.alt)
      setFile(null)
      setError(null)
    }
  }, [open])

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null
    setError(null)
    if (picked === null) {
      setFile(null)
      return
    }
    const rejection = describeRejectedFile(picked)
    if (rejection !== null) {
      setFile(null)
      setError(rejection)
      return
    }
    setFile(picked)
  }

  const metadataChanged = filename !== item.filename || alt !== item.alt
  const canSubmit =
    alt.trim().length > 0 &&
    filename.trim().length > 0 &&
    (metadataChanged || file !== null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    setError(null)
    setSubmitting(true)
    try {
      // Metadata first, deliberately: it is the cheap half and the half
      // that can be refused on a bound. Swapping the file before finding
      // out the alt is 400 characters long would have already deleted the
      // old image for an edit that then fails.
      if (metadataChanged) {
        await updateMedia({
          id: item._id,
          ...(filename !== item.filename ? { filename } : {}),
          ...(alt !== item.alt ? { alt } : {}),
        })
      }
      if (file !== null) {
        const uploaded = await uploadToStorage(
          () => generateUploadUrl({}),
          file
        )
        await replaceFile({ id: item._id, ...uploaded })
      }
      onOpenChange(false)
    } catch (err) {
      setError(describeMediaError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const formId = `edit-media-form-${item._id}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier le média</DialogTitle>
          <DialogDescription>
            {formatFileSize(item.size)} · {item.mime}
            {item.width !== undefined && item.height !== undefined
              ? ` · ${item.width} × ${item.height}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <form id={formId} onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`edit-filename-${item._id}`}>
                Nom du fichier
              </FieldLabel>
              <Input
                id={`edit-filename-${item._id}`}
                autoComplete="off"
                required
                maxLength={MAX_FILENAME_LENGTH}
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`edit-alt-${item._id}`}>
                Texte alternatif (obligatoire)
              </FieldLabel>
              <Input
                id={`edit-alt-${item._id}`}
                autoComplete="off"
                required
                maxLength={MAX_ALT_LENGTH}
                value={alt}
                onChange={(event) => setAlt(event.target.value)}
              />
              <FieldDescription>
                {alt.trim().length}/{MAX_ALT_LENGTH}
              </FieldDescription>
            </Field>
            {canReplaceFile && (
              <Field>
                <FieldLabel htmlFor={`edit-file-${item._id}`}>
                  Remplacer l'image
                </FieldLabel>
                <Input
                  id={`edit-file-${item._id}`}
                  type="file"
                  accept={ACCEPTED_MIME_ATTRIBUTE}
                  onChange={handleFileChange}
                />
                <FieldDescription>
                  {file
                    ? `${file.name} — ${formatFileSize(file.size)}`
                    : "Facultatif. La fiche et ses références sont conservées ; l'ancien fichier est supprimé."}
                </FieldDescription>
              </Field>
            )}
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button type="submit" form={formId} disabled={submitting || !canSubmit}>
            {submitting ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Pick a file from the library.
 *
 * `onSelect` receives the `storageId`, not the `media` row id: the fields
 * that designate a file (`posts.coverId`, `seo.ogImageId`) reference
 * `_storage` directly and the `media` row is a sidecar hanging off it
 * (Lot 3, Décision 1). Handing back the row id would make every caller
 * translate, and the first one to forget would store the wrong id.
 */
export function MediaPicker({
  open,
  onOpenChange,
  onSelect,
  selectedStorageId,
  title = "Choisir une image",
  description = "Sélectionnez un fichier de la médiathèque, ou téléversez-en un nouveau.",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (storageId: Id<"_storage">) => void
  selectedStorageId?: Id<"_storage"> | null
  title?: string
  description?: string
}) {
  // Only subscribed while the dialog is open: a picker mounted on every
  // row of an editor should not each hold a live subscription to the whole
  // library.
  const items = useQuery(api.media.list, open ? {} : "skip")
  const [uploadOpen, setUploadOpen] = useState(false)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto">
            {items === undefined ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                La médiathèque est vide. Téléversez une première image.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {items.map((item) => {
                  const isSelected = item.storageId === selectedStorageId
                  return (
                    <li key={item._id}>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => {
                          onSelect(item.storageId)
                          onOpenChange(false)
                        }}
                        className={cn(
                          "flex w-full flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                          isSelected ? "border-primary" : "border-border"
                        )}
                      >
                        <MediaThumbnail item={item} />
                        <span className="truncate px-0.5 text-xs font-medium">
                          {item.filename}
                        </span>
                        <span className="truncate px-0.5 text-xs text-muted-foreground">
                          {item.alt}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Annuler
            </DialogClose>
            <Button type="button" onClick={() => setUploadOpen(true)}>
              <UploadIcon data-icon="inline-start" />
              Téléverser
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rendered as a sibling rather than nested inside the picker's
          popup: two stacked modal dialogs fight over focus, and the upload
          form is the one that has to keep it. */}
      <UploadMediaDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(storageId) => {
          // A freshly uploaded file is almost always the one being looked
          // for — selecting it saves the operator finding it again in a
          // grid that just changed under them.
          onSelect(storageId)
          onOpenChange(false)
        }}
      />
    </>
  )
}

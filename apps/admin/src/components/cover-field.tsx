import { useState } from "react"
import { useQuery } from "convex/react"
import { ChevronDownIcon, ImageIcon, Trash2Icon } from "lucide-react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { CoverCaptionFields } from "@/components/cover-caption-fields"
import { CoverPreview } from "@/components/cover-preview"
import { GenerateCoverButton } from "@/components/generate-cover-button"
import { MediaPicker } from "@/components/media-picker"
import { Button } from "@/components/ui/button"

export function CoverField({
  value,
  disabled,
  generating,
  compact,
  onChange,
  onGenerate,
}: {
  value: Id<"_storage"> | null
  disabled: boolean
  generating: boolean
  compact?: boolean
  onChange: (value: Id<"_storage"> | null) => void
  onGenerate: (extraInstructions?: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const media = useQuery(api.media.list, value === null ? "skip" : {})
  const selected = media?.find((item) => item.storageId === value) ?? null
  const frameClass = compact
    ? "group/cover relative w-full max-w-md"
    : "group/cover relative w-full max-w-xl"

  return (
    <div className="flex flex-col gap-3">
      {value === null ? (
        <p className="text-sm text-muted-foreground">
          Aucune image de couverture.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className={frameClass}>
            {selected?.url ? (
              <CoverPreview
                url={selected.url}
                alt={selected.alt}
                title={selected.title}
                compact={compact}
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border border-input bg-muted">
                <ImageIcon className="size-5 text-muted-foreground" />
              </div>
            )}
            {!disabled && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Retirer la couverture"
                onClick={() => onChange(null)}
                className="absolute top-1.5 right-1.5 z-10 bg-background/90 text-red-600 opacity-0 shadow-sm hover:bg-background hover:text-red-700 group-hover/cover:opacity-100 focus:opacity-100 focus-visible:opacity-100"
              >
                <Trash2Icon />
              </Button>
            )}
          </div>
          {!compact && (
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium">
                {selected?.filename ?? "Fichier hors médiathèque"}
              </p>
              <p className="truncate text-muted-foreground">
                {selected?.alt ?? "Texte alternatif inconnu"}
              </p>
            </div>
          )}
          {selected ? (
            <details className="group/details rounded-lg border border-input">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                Détails de l’image
                <ChevronDownIcon className="ml-auto size-4 text-muted-foreground transition-transform group-open/details:rotate-180" />
              </summary>
              <div className="border-t border-input px-3 py-3">
                <CoverCaptionFields
                  mediaId={selected._id}
                  alt={selected.alt}
                  title={selected.title ?? ""}
                  disabled={disabled}
                  stacked
                  altId="cover-alt"
                  titleId="cover-title"
                />
              </div>
            </details>
          ) : null}
        </div>
      )}
      {!disabled && (
        <div className="flex items-stretch gap-2 max-sm:flex-wrap sm:flex-nowrap">
          <GenerateCoverButton
            disabled={disabled}
            busy={generating}
            onGenerate={onGenerate}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
            className="border-foreground/20 bg-background"
          >
            <ImageIcon data-icon="inline-start" />
            {value === null ? "Choisir une image" : "Changer d'image"}
          </Button>
        </div>
      )}
      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onChange}
        selectedStorageId={value}
        title="Image de couverture"
        description="Elle illustre la carte de l'article sur /blog et son partage social."
      />
    </div>
  )
}

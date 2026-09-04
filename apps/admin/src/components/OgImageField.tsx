import { useState } from "react"
import { useQuery } from "convex/react"
import { ImageIcon } from "lucide-react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { CoverCaptionFields } from "@/components/cover-caption-fields"
import { CoverPreview } from "@/components/cover-preview"
import { GenerateCoverButton } from "@/components/generate-cover-button"
import { MediaPicker } from "@/components/media-picker"
import { Button } from "@/components/ui/button"

export function OgImageField({
  value,
  disabled,
  generating = false,
  onChange,
  onGenerate,
}: {
  value: Id<"_storage"> | null
  disabled: boolean
  generating?: boolean
  onChange: (value: Id<"_storage"> | null) => void
  onGenerate?: (extraInstructions?: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const media = useQuery(api.media.list, value === null ? "skip" : {})
  const selected = media?.find((item) => item.storageId === value) ?? null

  return (
    <div className="flex flex-col gap-3">
      {value === null ? (
        <p className="text-sm text-muted-foreground">Aucune image de partage.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {selected?.url ? (
            <CoverPreview
              url={selected.url}
              alt={selected.alt}
              title={selected.title}
            />
          ) : (
            <div className="flex aspect-video w-full max-w-xl items-center justify-center overflow-hidden rounded-lg border border-input bg-muted">
              <ImageIcon className="size-5 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">
              {selected?.filename ?? "Fichier hors médiathèque"}
            </p>
            <p className="truncate text-muted-foreground">
              {selected?.alt ?? "Texte alternatif inconnu"}
            </p>
          </div>
          {selected ? (
            <CoverCaptionFields
              mediaId={selected._id}
              alt={selected.alt}
              title={selected.title ?? ""}
              disabled={disabled}
              altId="og-alt"
              titleId="og-title"
            />
          ) : null}
        </div>
      )}
      {!disabled && (
        <div className="flex items-stretch gap-2 max-sm:flex-wrap sm:flex-nowrap">
          {onGenerate ? (
            <GenerateCoverButton
              disabled={disabled}
              busy={generating}
              onGenerate={onGenerate}
            />
          ) : null}
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
          {value !== null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(null)}
            >
              Retirer
            </Button>
          )}
        </div>
      )}
      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onChange}
        selectedStorageId={value}
        title="Image de partage"
        description="Affichée quand la page est partagée sur les réseaux."
      />
    </div>
  )
}

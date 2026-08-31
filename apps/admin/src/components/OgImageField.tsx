import { useState } from "react"
import { useQuery } from "convex/react"
import { ImageIcon } from "lucide-react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { MediaPicker } from "@/components/media-picker"
import { Button } from "@/components/ui/button"

export function OgImageField({
  value,
  disabled,
  onChange,
}: {
  value: Id<"_storage"> | null
  disabled: boolean
  onChange: (value: Id<"_storage"> | null) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const media = useQuery(api.media.list, value === null ? "skip" : {})
  const selected = media?.find((item) => item.storageId === value) ?? null

  return (
    <div className="flex flex-col gap-3">
      {value === null ? (
        <p className="text-sm text-muted-foreground">Aucune image de partage.</p>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex size-20 items-center justify-center overflow-hidden rounded-lg border border-input bg-muted">
            {selected?.url ? (
              <img
                src={selected.url}
                alt={selected.alt}
                className="size-full object-cover"
              />
            ) : (
              <ImageIcon className="size-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">
              {selected?.filename ?? "Fichier hors médiathèque"}
            </p>
            <p className="truncate text-muted-foreground">
              {selected?.alt ?? "Texte alternatif inconnu"}
            </p>
          </div>
        </div>
      )}
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
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

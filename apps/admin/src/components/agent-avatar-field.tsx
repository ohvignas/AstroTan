import { useState } from "react"
import { useQuery } from "convex/react"
import { ImageIcon } from "lucide-react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import { resolveAgentAvatarUrl } from "@astrotan/backend/convex/lib/agentAvatar"
import { MediaPicker } from "@/components/media-picker"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"

export function AgentAvatarField({
  value,
  disabled,
  onChange,
}: {
  value: Id<"_storage"> | null
  disabled: boolean
  onChange: (value: Id<"_storage"> | null) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const media = useQuery(api.media.list, {})
  const selected = media?.find((item) => item.storageId === value) ?? null
  const preview = selected?.url ?? resolveAgentAvatarUrl(null)

  return (
    <Field>
      <FieldLabel>Image de l'agent</FieldLabel>
      <div className="flex items-center gap-3">
        <img
          src={preview}
          alt=""
          className="size-16 rounded-full border border-border bg-muted object-cover"
        />
        <div className="min-w-0 text-sm">
          <p className="truncate font-medium">
            {selected?.filename ?? "Image par défaut du template"}
          </p>
          {value === null ? (
            <p className="text-muted-foreground">
              Repli commité, tant qu'aucune image n'est choisie.
            </p>
          ) : null}
        </div>
      </div>
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
          >
            <ImageIcon data-icon="inline-start" />
            {value ? "Changer l'image" : "Choisir dans la médiathèque"}
          </Button>
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(null)}
            >
              Revenir au défaut
            </Button>
          ) : null}
        </div>
      ) : null}
      <FieldDescription>
        Affichée dans la bulle du site et dans l'aperçu ci-contre.
      </FieldDescription>
      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onChange}
        selectedStorageId={value}
        title="Avatar de l'agent"
        description="Image ronde dans la bulle d'aide."
      />
    </Field>
  )
}

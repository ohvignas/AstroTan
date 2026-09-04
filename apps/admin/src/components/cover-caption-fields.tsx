import { useEffect, useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import {
  MAX_ALT_LENGTH,
  MAX_MEDIA_TITLE_LENGTH,
} from "@astrotan/backend/convex/content"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function CoverCaptionFields({
  mediaId,
  alt,
  title,
  disabled,
  stacked,
  altId,
  titleId,
}: {
  mediaId: Id<"media">
  alt: string
  title: string
  disabled: boolean
  stacked?: boolean
  altId: string
  titleId: string
}) {
  const updateMedia = useMutation(api.media.update)
  const [altValue, setAltValue] = useState(alt)
  const [titleValue, setTitleValue] = useState(title)

  useEffect(() => {
    setAltValue(alt)
    setTitleValue(title)
  }, [mediaId, alt, title])

  return (
    <div className={stacked ? "grid gap-3" : "grid gap-3 sm:grid-cols-2"}>
      <Field>
        <FieldLabel htmlFor={altId}>Texte alternatif</FieldLabel>
        <Input
          id={altId}
          value={altValue}
          maxLength={MAX_ALT_LENGTH}
          disabled={disabled}
          onChange={(event) => setAltValue(event.target.value)}
          onBlur={() => {
            if (altValue.trim() !== "" && altValue !== alt) {
              void updateMedia({ id: mediaId, alt: altValue })
            }
          }}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={titleId}>Titre de l'image</FieldLabel>
        <Input
          id={titleId}
          value={titleValue}
          maxLength={MAX_MEDIA_TITLE_LENGTH}
          disabled={disabled}
          onChange={(event) => setTitleValue(event.target.value)}
          onBlur={() => {
            if (titleValue.trim() !== "" && titleValue !== title) {
              void updateMedia({ id: mediaId, title: titleValue })
            }
          }}
        />
      </Field>
    </div>
  )
}

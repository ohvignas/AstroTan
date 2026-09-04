import { ConvexError } from "convex/values"

export const MAX_META_PIXEL_ID_LENGTH = 20
export const MAX_GOOGLE_TAG_ID_LENGTH = 64
export const MAX_GOOGLE_CONVERSION_LABEL_LENGTH = 64

const META_PIXEL_ID = /^\d{5,20}$/
const GOOGLE_TAG_ID = /^(G|AW|GT|DC)-[A-Z0-9]+$/i
// Label d'une action de conversion Google Ads — la partie après `AW-XXX/`.
// L'UI Ads affiche `AW-123456789/AbC-D_efG-h12_34-567` : on accepte le
// suffixe seul, ou la chaîne entière (on n'en garde que le label).
const CONVERSION_LABEL = /^[A-Za-z0-9_-]{4,64}$/

export type PixelIdField = "metaPixelId" | "googleTagId" | "googleConversionLabel"

export function normaliserPixelId(field: PixelIdField, valeur: string | null): string {
  if (valeur === null) return ""
  const trimmed = valeur.trim()
  if (trimmed === "") return ""

  if (field === "googleConversionLabel") {
    const slash = trimmed.lastIndexOf("/")
    const label = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
    if (label.length > MAX_GOOGLE_CONVERSION_LABEL_LENGTH) {
      throw new ConvexError({
        code: "FIELD_TOO_LONG",
        field,
        max: MAX_GOOGLE_CONVERSION_LABEL_LENGTH,
      })
    }
    if (!CONVERSION_LABEL.test(label)) {
      throw new ConvexError({ code: "INVALID_PIXEL_ID", field })
    }
    return label
  }

  const max = field === "metaPixelId" ? MAX_META_PIXEL_ID_LENGTH : MAX_GOOGLE_TAG_ID_LENGTH
  if (trimmed.length > max) {
    throw new ConvexError({ code: "FIELD_TOO_LONG", field, max })
  }

  const pattern = field === "metaPixelId" ? META_PIXEL_ID : GOOGLE_TAG_ID
  if (!pattern.test(trimmed)) {
    throw new ConvexError({ code: "INVALID_PIXEL_ID", field })
  }

  return trimmed
}

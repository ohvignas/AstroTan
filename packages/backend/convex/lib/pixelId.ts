import { ConvexError } from "convex/values"

export const MAX_META_PIXEL_ID_LENGTH = 20
export const MAX_GOOGLE_TAG_ID_LENGTH = 64

const META_PIXEL_ID = /^\d{5,20}$/
const GOOGLE_TAG_ID = /^(G|AW|GT|DC)-[A-Z0-9]+$/i

export type PixelIdField = "metaPixelId" | "googleTagId"

export function normaliserPixelId(field: PixelIdField, valeur: string | null): string {
  if (valeur === null) return ""
  const trimmed = valeur.trim()
  if (trimmed === "") return ""

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

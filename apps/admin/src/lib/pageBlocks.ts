import { BLOCK_TYPES } from "@astrotan/backend/convex/blocks"
import type { Block } from "@astrotan/backend/convex/blocks"

// Re-exported so route files only ever import block-related helpers from
// one place — `BLOCK_TYPES` is otherwise a backend implementation detail
// this app happens to also need (the "add a block" dropdown must offer
// exactly the six types the union accepts, not a hand-maintained copy of
// that list that could drift from it).
export { BLOCK_TYPES }
export type { Block }

export const BLOCK_TYPE_LABELS: Record<Block["type"], string> = {
  hero: "Hero",
  richText: "Texte riche",
  features: "Fonctionnalités",
  gallery: "Galerie",
  faq: "FAQ",
  cta: "Appel à l'action",
}

// One instance of each type, used both as the "add a block" default and
// as the shape a freshly-added block starts from before an operator fills
// it in. Every field the block validator accepts appears here explicitly
// (as its empty/undefined form) rather than being omitted — the editor
// form for each type reads and writes these same keys, so a field this
// factory forgets would silently never be editable.
export function createDefaultBlock(type: Block["type"]): Block {
  switch (type) {
    case "hero":
      return { type: "hero", title: "", subtitle: undefined, cta: undefined }
    case "richText":
      return { type: "richText", html: "" }
    case "features":
      return { type: "features", items: [] }
    case "gallery":
      return { type: "gallery", mediaIds: [] }
    case "faq":
      return { type: "faq", items: [] }
    case "cta":
      return { type: "cta", title: "", cta: { label: "", href: "" } }
    default: {
      const exhaustive: never = type
      throw new Error(`Unknown block type: ${exhaustive}`)
    }
  }
}

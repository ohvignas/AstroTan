import { ConvexError } from "convex/values"

export const MAX_EXTRA_INSTRUCTIONS = 500

export function normalizeExtraInstructions(
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed.length > MAX_EXTRA_INSTRUCTIONS) {
    throw new ConvexError({
      code: "FIELD_TOO_LONG",
      field: "extraInstructions",
      max: MAX_EXTRA_INSTRUCTIONS,
    })
  }
  return trimmed
}

export function appendExtraInstructions(
  prompt: string,
  extra: string | undefined,
): string {
  const cleaned = extra === undefined ? undefined : extra.trim()
  if (!cleaned) return prompt
  return `${prompt}\n\nInstruction complémentaire :\n${cleaned}`
}

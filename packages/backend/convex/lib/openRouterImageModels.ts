import { ConvexError } from "convex/values"

/**
 * Modèles image OpenRouter, slugs vérifiés le 2026-09-01
 * via les pages modèle (Image API `POST /api/v1/images`).
 * https://openrouter.ai/google/gemini-3-pro-image
 * https://openrouter.ai/google/gemini-3.1-flash-image
 * https://openrouter.ai/google/gemini-2.5-flash-image
 */
export const OPENROUTER_IMAGE_MODELS = [
  {
    id: "google/gemini-3-pro-image",
    label: "Gemini 3 Pro Image — défaut (Nano Banana Pro)",
  },
  {
    id: "google/gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image — rapide",
  },
  {
    id: "google/gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image — économique",
  },
] as const

export type OpenRouterImageModelId = (typeof OPENROUTER_IMAGE_MODELS)[number]["id"]

/** Flagship Gemini image réellement servi (Nano Banana Pro). */
export const DEFAULT_OPENROUTER_IMAGE_MODEL: OpenRouterImageModelId =
  "google/gemini-3-pro-image"

const ALLOWED = new Set<string>(OPENROUTER_IMAGE_MODELS.map((model) => model.id))

export function isOpenRouterImageModelId(
  id: string,
): id is OpenRouterImageModelId {
  return ALLOWED.has(id)
}

export function resolveOpenRouterImageModel(
  id: string | null | undefined,
): OpenRouterImageModelId {
  if (id !== null && id !== undefined && isOpenRouterImageModelId(id)) return id
  return DEFAULT_OPENROUTER_IMAGE_MODEL
}

export function assertOpenRouterImageModel(
  value: string | null | undefined,
): OpenRouterImageModelId | undefined {
  if (value === undefined) return undefined
  if (value === null || value.trim() === "") return undefined
  if (!isOpenRouterImageModelId(value)) {
    throw new ConvexError({ code: "INVALID_OPENROUTER_IMAGE_MODEL" })
  }
  return value
}

import { ConvexError } from "convex/values"

/**
 * Moteur PDF OpenRouter documenté (pas un slug de modèle) :
 * https://openrouter.ai/docs/guides/overview/multimodal/pdfs
 * `mistral-ocr` = OCR dédié pour scans / Canva. $2 / 1 000 pages.
 * Aucun slug `mistralai/mistral-ocr-latest` n'existe sur GET /api/v1/models
 * (vérifié 2026-09-02).
 */
export const OPENROUTER_OCR_ENGINE = "mistral-ocr" as const

/**
 * Modèles chat qui portent la requête file-parser. Le texte OCR vient des
 * annotations du moteur, pas d'une boucle vision page à page.
 * Slugs vérifiés le 2026-09-02 via GET https://openrouter.ai/api/v1/models.
 */
export const OPENROUTER_OCR_MODELS = [
  {
    id: "google/gemini-2.5-flash",
    label: "OCR Mistral + Gemini 2.5 Flash — défaut",
  },
  {
    id: "google/gemini-3.1-pro-preview",
    label: "OCR Mistral + Gemini 3.1 Pro",
  },
  {
    id: "qwen/qwen3-vl-235b-a22b-instruct",
    label: "OCR Mistral + Qwen3 VL",
  },
  {
    id: "openai/gpt-5.5",
    label: "OCR Mistral + GPT-5.5",
  },
] as const

export type OpenRouterOcrModelId = (typeof OPENROUTER_OCR_MODELS)[number]["id"]

export const DEFAULT_OPENROUTER_OCR_MODEL: OpenRouterOcrModelId =
  "google/gemini-2.5-flash"

const ALLOWED = new Set<string>(OPENROUTER_OCR_MODELS.map((model) => model.id))

export function isOpenRouterOcrModelId(id: string): id is OpenRouterOcrModelId {
  return ALLOWED.has(id)
}

export function resolveOpenRouterOcrModel(
  id: string | null | undefined,
): OpenRouterOcrModelId {
  if (id !== null && id !== undefined && isOpenRouterOcrModelId(id)) return id
  return DEFAULT_OPENROUTER_OCR_MODEL
}

export function assertOpenRouterOcrModel(
  value: string | null | undefined,
): OpenRouterOcrModelId | undefined {
  if (value === undefined) return undefined
  if (value === null || value.trim() === "") return undefined
  if (!isOpenRouterOcrModelId(value)) {
    throw new ConvexError({ code: "INVALID_OPENROUTER_OCR_MODEL" })
  }
  return value
}

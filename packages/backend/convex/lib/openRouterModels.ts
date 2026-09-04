import { ConvexError } from "convex/values"

/**
 * Liste courte, IDs OpenRouter officiels vérifiés le 2026-09-04
 * via GET https://openrouter.ai/api/v1/models.
 * Pas un secret : le texte vit dans `settings.openRouterModel`,
 * le chat dans `settings.openRouterAgentModel` (getPrivate).
 */
export const OPENROUTER_MODELS = [
  {
    id: "google/gemini-3.7-flash",
    label: "Gemini 3.7 Flash — défaut",
  },
  {
    id: "x-ai/grok-4.6",
    label: "Grok 4.6 — SEO",
  },
  {
    id: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro — précis",
  },
  {
    id: "openai/gpt-5.6-sol",
    label: "GPT-5.6 Sol — le plus récent",
  },
  {
    id: "anthropic/claude-opus-5",
    label: "Claude Opus 5 — qualité rédaction",
  },
  {
    id: "deepseek/deepseek-v4-pro-0813",
    label: "DeepSeek V4 Pro — structuré",
  },
] as const

export type OpenRouterModelId = (typeof OPENROUTER_MODELS)[number]["id"]

/** Défaut : slug demandé pour l'agent, JSON structuré, bon rapport qualité/prix. */
export const DEFAULT_OPENROUTER_MODEL: OpenRouterModelId = "google/gemini-3.7-flash"

const ALLOWED = new Set<string>(OPENROUTER_MODELS.map((model) => model.id))

export function isOpenRouterModelId(id: string): id is OpenRouterModelId {
  return ALLOWED.has(id)
}

export function resolveOpenRouterModel(
  id: string | null | undefined,
): OpenRouterModelId {
  if (id !== null && id !== undefined && isOpenRouterModelId(id)) return id
  return DEFAULT_OPENROUTER_MODEL
}

/** Chat : `openRouterAgentModel`, sinon `openRouterModel`, sinon le défaut. */
export function resolveOpenRouterAgentModel(
  agentId: string | null | undefined,
  textId?: string | null,
): OpenRouterModelId {
  if (agentId !== null && agentId !== undefined && isOpenRouterModelId(agentId)) {
    return agentId
  }
  return resolveOpenRouterModel(textId)
}

/**
 * `undefined` = ne pas patcher. `null` / vide = effacer (repli défaut à la lecture).
 * Tout autre id hors liste est refusé.
 */
export function assertOpenRouterModel(
  value: string | null | undefined,
): OpenRouterModelId | undefined {
  if (value === undefined) return undefined
  if (value === null || value.trim() === "") return undefined
  if (!isOpenRouterModelId(value)) {
    throw new ConvexError({ code: "INVALID_OPENROUTER_MODEL" })
  }
  return value
}

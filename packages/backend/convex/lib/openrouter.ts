import { ConvexError } from "convex/values"

import { DEFAULT_OPENROUTER_MODEL } from "./openRouterModels"
import { contentFromChoice, jsonDepuisReponse } from "./parseModelJson"

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
/**
 * GET documenté — métadonnées de la clé courante, sans générer.
 * https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key
 */
export const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key"
/** @deprecated Préférer DEFAULT_OPENROUTER_MODEL — conservé pour les imports existants. */
export const OPENROUTER_MODEL = DEFAULT_OPENROUTER_MODEL
/** Ping /key : assez court. Une génération flagship dépasse largement 8 s. */
export const OPENROUTER_TIMEOUT_MS = 8_000
export const OPENROUTER_CHAT_TIMEOUT_MS = 60_000

export type OpenRouterPingIssue = "valide" | "refuse" | "injoignable"

export type OpenRouterErrorCode =
  | "OPENROUTER_REFUSED"
  | "OPENROUTER_UNAVAILABLE"
  | "OPENROUTER_BAD_RESPONSE"

export function interpretOpenRouterStatus(status: number): OpenRouterErrorCode | null {
  if (status === 401 || status === 403) return "OPENROUTER_REFUSED"
  if (status === 200) return null
  if (status === 429 || status >= 500) return "OPENROUTER_UNAVAILABLE"
  return "OPENROUTER_UNAVAILABLE"
}

export async function pingOpenRouter(apiKey: string): Promise<OpenRouterPingIssue> {
  let reponse: Response
  try {
    reponse = await fetch(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
    })
  } catch {
    return "injoignable"
  }
  const code = interpretOpenRouterStatus(reponse.status)
  if (code === null) return "valide"
  if (code === "OPENROUTER_REFUSED") return "refuse"
  return "injoignable"
}

export function extractMessageContent(payload: unknown): string {
  return contentFromChoice(payload)
}

export async function completerJson(args: {
  apiKey: string
  system: string
  user: string
  model: string
  referer?: string
}): Promise<unknown> {
  let reponse: Response
  try {
    reponse = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        ...(args.referer ? { "HTTP-Referer": args.referer } : {}),
        "X-Title": "AstroTan",
      },
      body: JSON.stringify({
        model: args.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
      }),
      signal: AbortSignal.timeout(OPENROUTER_CHAT_TIMEOUT_MS),
    })
  } catch {
    throw new ConvexError({ code: "OPENROUTER_UNAVAILABLE" })
  }

  const refuse = interpretOpenRouterStatus(reponse.status)
  if (refuse !== null) {
    throw new ConvexError({ code: refuse })
  }

  let texte: string
  try {
    texte = await reponse.text()
  } catch {
    throw new ConvexError({ code: "OPENROUTER_BAD_RESPONSE", reason: "parse" })
  }

  return jsonDepuisReponse(texte)
}

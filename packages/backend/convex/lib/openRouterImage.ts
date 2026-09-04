import { ConvexError } from "convex/values"

import { coverGenerationParams } from "./coverImage"
import { interpretOpenRouterStatus } from "./openrouter"

export const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images"
export const OPENROUTER_IMAGE_TIMEOUT_MS = 90_000

export type GeneratedImage = {
  bytes: Uint8Array
  mime: "image/png" | "image/jpeg" | "image/webp"
}

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"])

function decodeB64(raw: string): Uint8Array {
  const cleaned = raw.replace(/^data:image\/[a-z+]+;base64,/, "")
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function pickMime(value: unknown): GeneratedImage["mime"] {
  if (typeof value === "string" && ALLOWED_MIME.has(value)) {
    return value as GeneratedImage["mime"]
  }
  return "image/png"
}

export async function genererImage(args: {
  apiKey: string
  model: string
  prompt: string
  referer?: string
}): Promise<GeneratedImage> {
  let reponse: Response
  try {
    reponse = await fetch(OPENROUTER_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        ...(args.referer ? { "HTTP-Referer": args.referer } : {}),
        "X-Title": "AstroTan",
      },
      body: JSON.stringify({
        model: args.model,
        prompt: args.prompt,
        n: 1,
        ...coverGenerationParams(args.model),
      }),
      signal: AbortSignal.timeout(OPENROUTER_IMAGE_TIMEOUT_MS),
    })
  } catch {
    throw new ConvexError({ code: "OPENROUTER_UNAVAILABLE" })
  }

  const refuse = interpretOpenRouterStatus(reponse.status)
  if (refuse !== null) {
    throw new ConvexError({ code: refuse })
  }

  let payload: unknown
  try {
    payload = await reponse.json()
  } catch {
    throw new ConvexError({ code: "OPENROUTER_BAD_IMAGE" })
  }

  const data = (payload as { data?: unknown } | null)?.data
  const first = Array.isArray(data) ? data[0] : undefined
  const b64 = (first as { b64_json?: unknown } | undefined)?.b64_json
  if (typeof b64 !== "string" || b64.length === 0) {
    throw new ConvexError({ code: "OPENROUTER_BAD_IMAGE" })
  }
  const bytes = decodeB64(b64)
  if (bytes.length === 0) {
    throw new ConvexError({ code: "OPENROUTER_BAD_IMAGE" })
  }
  return {
    bytes,
    mime: pickMime((first as { media_type?: unknown }).media_type),
  }
}

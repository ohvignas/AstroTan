"use node"

import { ExtractFailure } from "./extractErrors"
import { OPENROUTER_OCR_ENGINE } from "./openRouterOcrModels"
import { OPENROUTER_CHAT_TIMEOUT_MS, OPENROUTER_CHAT_URL } from "./openrouter"

export { OCR_BATCH_PAGES, ocrPageBatches } from "./ocrBatches"
export const OCR_TIMEOUT_MS = OPENROUTER_CHAT_TIMEOUT_MS

export type OcrPdfArgs = {
  bytes: Uint8Array
  filename: string
  apiKey: string
  model: string
}

export type ExtractPdfForKnowledgeOptions = {
  apiKey: string | null
  model: string
  filename: string
  ocr?: (args: OcrPdfArgs) => Promise<string>
  slice?: (bytes: Uint8Array, start: number, end: number) => Promise<Uint8Array>
}

export type ExtractPdfStepOptions = ExtractPdfForKnowledgeOptions & {
  ocrPage?: number
  priorMarkdown?: string
}

export type PdfExtractStep =
  | { status: "done"; markdown: string }
  | { status: "continue"; markdown: string; ocrPage: number; ocrTotal: number }

function textsFromUnknownParts(parts: unknown): string[] {
  if (!Array.isArray(parts)) return []
  const out: string[] = []
  for (const part of parts) {
    if (typeof part === "string" && part.trim()) out.push(part)
    if (part && typeof part === "object" && "text" in part) {
      const text = (part as { text?: unknown }).text
      if (typeof text === "string" && text.trim()) out.push(text)
    }
  }
  return out
}

function annotationsFrom(payload: unknown): unknown[] {
  if (payload === null || typeof payload !== "object") return []
  const root = payload as {
    choices?: Array<{ message?: { annotations?: unknown[] } }>
    error?: { metadata?: { file_annotations?: unknown[] } }
  }
  return [
    ...(root.choices?.[0]?.message?.annotations ?? []),
    ...(root.error?.metadata?.file_annotations ?? []),
  ]
}

export function markdownFromOcrResponse(payload: unknown): string {
  const chunks: string[] = []
  for (const annotation of annotationsFrom(payload)) {
    if (annotation === null || typeof annotation !== "object") continue
    const file = (annotation as { type?: unknown; file?: { content?: unknown } }).file
    if ((annotation as { type?: unknown }).type !== "file") continue
    chunks.push(...textsFromUnknownParts(file?.content))
  }
  const fromAnnotations = chunks.join("\n\n").trim()
  if (fromAnnotations.length > 0) return fromAnnotations

  const choices = (payload as { choices?: unknown } | null)?.choices
  const first = Array.isArray(choices) ? choices[0] : undefined
  const content = (first as { message?: { content?: unknown } } | undefined)?.message
    ?.content
  if (typeof content === "string" && content.trim()) return content.trim()
  const fromParts = textsFromUnknownParts(content).join("\n").trim()
  if (fromParts.length > 0) return fromParts

  throw new ExtractFailure("ocr")
}

export async function ocrPdfWithOpenRouter(args: OcrPdfArgs): Promise<string> {
  const dataUrl = `data:application/pdf;base64,${Buffer.from(args.bytes).toString("base64")}`
  let response: Response
  try {
    response = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "AstroTan",
      },
      body: JSON.stringify({
        model: args.model,
        plugins: [{ id: "file-parser", pdf: { engine: OPENROUTER_OCR_ENGINE } }],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcris ce document en Markdown fidèle. Ne résume pas. Ne commente pas.",
              },
              {
                type: "file",
                file: {
                  filename: args.filename,
                  file_data: dataUrl,
                },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ExtractFailure("timeout")
    }
    throw new ExtractFailure("ocr")
  }

  if (response.status === 401 || response.status === 403) {
    throw new ExtractFailure("noKey")
  }
  if (response.status === 408 || response.status === 504) {
    throw new ExtractFailure("timeout")
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ExtractFailure("ocr")
  }

  if (!response.ok) {
    try {
      return markdownFromOcrResponse(payload)
    } catch (error) {
      if (error instanceof ExtractFailure) throw error
      throw new ExtractFailure("ocr")
    }
  }

  return markdownFromOcrResponse(payload)
}

export async function ocrPdfWithRetry(args: OcrPdfArgs & {
  ocr?: (call: OcrPdfArgs) => Promise<string>
}): Promise<string> {
  const ocr = args.ocr ?? ocrPdfWithOpenRouter
  const call: OcrPdfArgs = {
    bytes: args.bytes,
    filename: args.filename,
    apiKey: args.apiKey,
    model: args.model,
  }
  try {
    return await ocr(call)
  } catch (error) {
    if (error instanceof ExtractFailure && error.code === "noKey") throw error
    try {
      return await ocr(call)
    } catch (retryError) {
      if (retryError instanceof ExtractFailure) throw retryError
      throw new ExtractFailure("ocr")
    }
  }
}


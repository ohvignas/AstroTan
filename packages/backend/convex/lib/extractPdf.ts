"use node"

import { ExtractFailure } from "./extractErrors"

export type PdfTextLayer = { text: string; totalPages: number }

/** Copie autonome : unpdf et pdf-lib détachent l'ArrayBuffer qu'on leur passe. */
export function isolatePdfBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

export async function inspectPdfText(bytes: Uint8Array): Promise<PdfTextLayer> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf")
    const pdf = await getDocumentProxy(isolatePdfBytes(bytes))
    const result = await extractText(pdf, { mergePages: true })
    const text = (Array.isArray(result.text) ? result.text.join("\n") : result.text).trim()
    return { text, totalPages: result.totalPages }
  } catch (error) {
    if (error instanceof ExtractFailure) throw error
    throw new ExtractFailure("parse")
  }
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const layer = await inspectPdfText(bytes)
  if (layer.text.length === 0) {
    throw new ExtractFailure(layer.totalPages > 0 ? "empty" : "parse")
  }
  return layer.text
}

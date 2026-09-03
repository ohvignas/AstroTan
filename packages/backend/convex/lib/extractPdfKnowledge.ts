"use node"

import { cleanDocumentForRag } from "./cleanDocumentForRag"
import { ExtractFailure } from "./extractErrors"
import { inspectPdfText, isolatePdfBytes } from "./extractPdf"
import {
  OCR_BATCH_PAGES,
  joinOcrMarkdown,
  ocrPageBatches,
} from "./ocrBatches"
import {
  ocrPdfWithRetry,
  type ExtractPdfForKnowledgeOptions,
  type ExtractPdfStepOptions,
  type PdfExtractStep,
} from "./extractPdfOcr"
import { slicePdfPages } from "./slicePdf"

export async function extractPdfStep(
  bytes: Uint8Array,
  options: ExtractPdfStepOptions,
): Promise<PdfExtractStep> {
  const layer = await inspectPdfText(bytes)
  if (layer.totalPages === 0 && layer.text.length === 0) {
    throw new ExtractFailure("parse")
  }
  if (layer.text.length > 0) {
    const fromLayer = cleanDocumentForRag(layer.text)
    if (fromLayer.length > 0) return { status: "done", markdown: fromLayer }
  }
  if (options.apiKey === null || options.apiKey.trim().length === 0) {
    throw new ExtractFailure("noKey")
  }

  const donePages = options.ocrPage ?? 0
  const batches = ocrPageBatches(layer.totalPages)
  const batch = batches.find((item) => item.start === donePages)
  if (donePages === 0 && layer.totalPages > OCR_BATCH_PAGES) {
    console.info(
      `[ocr] ${layer.totalPages} pages → ${batches.length} lots de ${OCR_BATCH_PAGES}`,
    )
  }
  if (batch === undefined || donePages >= layer.totalPages) {
    const cleaned = cleanDocumentForRag(options.priorMarkdown ?? "")
    if (cleaned.length === 0) throw new ExtractFailure("empty")
    return { status: "done", markdown: cleaned }
  }

  const sliceFn = options.slice ?? slicePdfPages
  let slice: Uint8Array
  let sliced = true
  try {
    slice =
      batch.start === 0 && batch.end >= layer.totalPages
        ? isolatePdfBytes(bytes)
        : await sliceFn(bytes, batch.start, batch.end)
  } catch (error) {
    if (error instanceof ExtractFailure && error.code !== "parse") throw error
    if (batch.start !== 0) throw new ExtractFailure("parse")
    // pdf-lib a refusé le découpage (buffer détaché, PDF Canva atypique) :
    // on envoie le document entier au moteur OCR plutôt que d'échouer.
    slice = isolatePdfBytes(bytes)
    sliced = false
  }

  let raw: string
  try {
    raw = await ocrPdfWithRetry({
      bytes: slice,
      filename: options.filename,
      apiKey: options.apiKey,
      model: options.model,
      ocr: options.ocr,
    })
  } catch (error) {
    if (error instanceof ExtractFailure) throw error
    throw new ExtractFailure("ocr")
  }

  if (!sliced) {
    const cleaned = cleanDocumentForRag(joinOcrMarkdown([options.priorMarkdown ?? "", raw]))
    if (cleaned.length === 0) throw new ExtractFailure("empty")
    return { status: "done", markdown: cleaned }
  }

  const combined = joinOcrMarkdown([options.priorMarkdown ?? "", raw])
  if (batch.end >= layer.totalPages) {
    const cleaned = cleanDocumentForRag(combined)
    if (cleaned.length === 0) throw new ExtractFailure("empty")
    return { status: "done", markdown: cleaned }
  }
  return {
    status: "continue",
    markdown: combined,
    ocrPage: batch.end,
    ocrTotal: layer.totalPages,
  }
}

export async function extractPdfForKnowledge(
  bytes: Uint8Array,
  options: ExtractPdfForKnowledgeOptions,
): Promise<string> {
  let ocrPage = 0
  let priorMarkdown = ""
  while (true) {
    const step = await extractPdfStep(bytes, { ...options, ocrPage, priorMarkdown })
    if (step.status === "done") return step.markdown
    ocrPage = step.ocrPage
    priorMarkdown = step.markdown
  }
}

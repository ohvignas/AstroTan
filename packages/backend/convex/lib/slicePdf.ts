"use node"

import { ExtractFailure } from "./extractErrors"
import { isolatePdfBytes } from "./extractPdf"

type PdfLibDocument = {
  getPageCount: () => number
  copyPages: (source: PdfLibDocument, indices: number[]) => Promise<unknown[]>
  addPage: (page: unknown) => void
  save: () => Promise<Uint8Array>
}

type PdfLib = {
  PDFDocument: {
    load: (bytes: Uint8Array, options?: { ignoreEncryption?: boolean }) => Promise<PdfLibDocument>
    create: () => Promise<PdfLibDocument>
  }
}

async function loadPdfLib(): Promise<PdfLib> {
  try {
    const { createRequire } = await import("node:module")
    return createRequire(import.meta.url)("pdf-lib") as PdfLib
  } catch {
    return (await import("pdf-lib")) as unknown as PdfLib
  }
}

export async function slicePdfPages(
  bytes: Uint8Array,
  start: number,
  end: number,
): Promise<Uint8Array> {
  try {
    const { PDFDocument } = await loadPdfLib()
    const source = await PDFDocument.load(isolatePdfBytes(bytes), { ignoreEncryption: true })
    const total = source.getPageCount()
    const from = Math.max(0, start)
    const to = Math.min(total, end)
    if (from === 0 && to >= total) return isolatePdfBytes(bytes)
    const dest = await PDFDocument.create()
    const copied = await dest.copyPages(
      source,
      Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i),
    )
    for (const page of copied) dest.addPage(page)
    return dest.save()
  } catch (error) {
    if (error instanceof ExtractFailure) throw error
    throw new ExtractFailure("parse")
  }
}

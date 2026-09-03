/** Pages par appel OpenRouter `mistral-ocr`. Au-delà, on enchaîne un autre lot. */
export const OCR_BATCH_PAGES = 10

export type OcrPageBatch = { start: number; end: number }

export function ocrPageBatches(
  totalPages: number,
  batchSize = OCR_BATCH_PAGES,
): OcrPageBatch[] {
  if (totalPages <= 0 || batchSize <= 0) return []
  const batches: OcrPageBatch[] = []
  for (let start = 0; start < totalPages; start += batchSize) {
    batches.push({ start, end: Math.min(start + batchSize, totalPages) })
  }
  return batches
}

export function joinOcrMarkdown(chunks: string[]): string {
  return chunks
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .join("\n\n")
}

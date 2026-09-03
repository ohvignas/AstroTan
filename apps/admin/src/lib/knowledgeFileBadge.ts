export function knowledgeFileBadge(file: {
  extractedMarkdown: string
  extractError?: string
  indexStatus?: "pending" | "indexed" | "error"
  ocrPage?: number
  ocrTotal?: number
}): "Extraction" | "À indexer" | "Indexation" | "Indexé" | "Erreur" | `OCR ${number}/${number}` {
  if (file.extractError) return "Erreur"
  if (
    typeof file.ocrTotal === "number" &&
    file.ocrTotal > 0 &&
    (file.ocrPage ?? 0) < file.ocrTotal
  ) {
    return `OCR ${file.ocrPage ?? 0}/${file.ocrTotal}`
  }
  if (file.extractedMarkdown.trim().length === 0) return "Extraction"
  if (file.indexStatus === "pending") return "Indexation"
  if (file.indexStatus === "indexed") return "Indexé"
  if (file.indexStatus === "error") return "Erreur"
  return "À indexer"
}

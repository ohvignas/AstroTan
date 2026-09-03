import { knowledgeFileBadge } from "./knowledgeFileBadge"

export type KnowledgeProgressFile = {
  extractedMarkdown: string
  extractError?: string
  indexStatus?: "pending" | "indexed" | "error"
  ocrPage?: number
  ocrTotal?: number
}

export function knowledgeProgressPercent({
  ocrPage,
  ocrTotal,
  indexStatus,
}: {
  ocrPage?: number
  ocrTotal?: number
  indexStatus?: "pending" | "indexed" | "error"
}): number | null {
  if (indexStatus === "error") return null
  if (indexStatus === "indexed") return 100
  if (typeof ocrTotal !== "number" || ocrTotal <= 0) return null
  const page = Math.max(0, ocrPage ?? 0)
  return Math.min(100, Math.round((page / ocrTotal) * 100))
}

function isOcrInProgress(file: KnowledgeProgressFile): boolean {
  return (
    !file.extractError &&
    typeof file.ocrTotal === "number" &&
    file.ocrTotal > 0 &&
    (file.ocrPage ?? 0) < file.ocrTotal
  )
}

function isExtractRestarted(file: KnowledgeProgressFile): boolean {
  return (
    file.extractedMarkdown.trim().length === 0 &&
    (typeof file.ocrTotal !== "number" || file.ocrTotal <= 0)
  )
}

export function knowledgeFileStatusModel(
  file: KnowledgeProgressFile,
  heldPercent: number | null = null,
): {
  kind: "working" | "indexed" | "error" | "idle"
  label: string
  percent: number | null
  nextHeld: number | null
} {
  const computed = knowledgeProgressPercent(file)
  const nextHeld =
    file.extractError || file.indexStatus === "error" || isExtractRestarted(file)
      ? null
      : computed !== null && file.indexStatus !== "indexed"
        ? computed
        : heldPercent

  if (file.extractError || file.indexStatus === "error") {
    return { kind: "error", label: "Erreur", percent: null, nextHeld: null }
  }

  if (file.indexStatus === "indexed") {
    return { kind: "indexed", label: "Indexé", percent: null, nextHeld: null }
  }

  const inProgress =
    isOcrInProgress(file) ||
    file.extractedMarkdown.trim().length === 0 ||
    file.indexStatus === "pending"

  if (inProgress) {
    const percent =
      computed ?? (file.indexStatus === "pending" ? heldPercent : null)
    const label =
      percent !== null
        ? `${percent} %`
        : file.indexStatus === "pending"
          ? "Indexation…"
          : "Extraction…"
    return { kind: "working", label, percent, nextHeld }
  }

  return {
    kind: "idle",
    label: knowledgeFileBadge(file),
    percent: null,
    nextHeld,
  }
}

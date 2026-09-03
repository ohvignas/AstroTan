import {
  ALLOWED_KNOWLEDGE_MIME_TYPES,
  MAX_AGENT_KNOWLEDGE_FILE_MARKDOWN,
} from "../content"

const TEXT_MIME = new Set(["text/plain", "text/markdown", "text/x-markdown"])

function normalizeMime(mimeType: string): string {
  return mimeType.split(";")[0]!.trim().toLowerCase()
}

function looksLikeTextFile(mimeType: string, filename: string): boolean {
  const lower = filename.toLowerCase()
  if (lower.endsWith(".pdf") || lower.endsWith(".docx")) return false
  if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".markdown")) {
    return true
  }
  return TEXT_MIME.has(normalizeMime(mimeType))
}

export function isTextKnowledgeFile(mimeType: string, filename: string): boolean {
  return looksLikeTextFile(mimeType, filename)
}

export function inferKnowledgeMime(mimeType: string, filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown"
  if (lower.endsWith(".txt")) return "text/plain"
  return normalizeMime(mimeType)
}

export function isAllowedKnowledgeMime(mimeType: string, filename: string): boolean {
  const inferred = inferKnowledgeMime(mimeType, filename)
  if ((ALLOWED_KNOWLEDGE_MIME_TYPES as readonly string[]).includes(inferred)) return true
  return looksLikeTextFile(inferred, filename)
}

export function extractKnowledgeMarkdown(
  bytes: Uint8Array,
  mimeType: string,
  filename: string,
): string {
  if (!looksLikeTextFile(mimeType, filename)) {
    throw new Error("UNSUPPORTED_KNOWLEDGE_MIME")
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "")
  return text.trim().slice(0, MAX_AGENT_KNOWLEDGE_FILE_MARKDOWN)
}

import {
  cleanDocumentForRag,
  isTooShortForRag,
  prepareRagText,
} from "./cleanDocumentForRag"

export const SITE_RAG_NAMESPACE = "site"
export const SITE_EMBEDDING_MODEL = "openai/text-embedding-3-small"
export const SITE_EMBEDDING_DIMENSION = 1536

export type RagSource = "knowledge" | "page"

export type RagEntryDraft = {
  key: string
  title: string
  text: string
  source: RagSource
}

export function knowledgeEntries(
  files: { id: string; filename: string; extractedMarkdown: string }[],
  leftover?: string | null,
): RagEntryDraft[] {
  const entries: RagEntryDraft[] = []
  for (const file of files) {
    const text = cleanDocumentForRag(file.extractedMarkdown)
    if (text.length === 0) continue
    entries.push({
      key: `knowledge:${file.id}`,
      title: file.filename.trim() || file.id,
      text,
      source: "knowledge",
    })
  }
  const extra = cleanDocumentForRag(leftover ?? "")
  if (extra.length > 0) {
    entries.push({
      key: "knowledge:settings",
      title: "Base rédigée",
      text: extra,
      source: "knowledge",
    })
  }
  return entries
}

export function publishedPageCandidates(
  pages: { slug: string; title: string; status: string }[],
): { slug: string; title: string }[] {
  return pages
    .filter((page) => page.status === "published")
    .map((page) => ({ slug: page.slug, title: page.title }))
}

export function pageEntry(
  page: { slug: string; title: string },
  fetchedText: string | null,
): RagEntryDraft | null {
  if (fetchedText == null) return null
  const text = prepareRagText(fetchedText)
  if (text.length === 0 || isTooShortForRag(text)) return null
  return {
    key: `page:${page.slug}`,
    title: page.title,
    text,
    source: "page",
  }
}

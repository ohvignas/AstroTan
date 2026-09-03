import { MAX_AGENT_KNOWLEDGE_CONCAT } from "../content"

export function concatKnowledgeMarkdown(
  files: { filename: string; extractedMarkdown: string }[],
  leftover?: string | null,
  max = MAX_AGENT_KNOWLEDGE_CONCAT,
): string {
  const parts = files
    .map((file) => ({
      filename: file.filename.trim(),
      markdown: file.extractedMarkdown.trim(),
    }))
    .filter((file) => file.markdown.length > 0)
    .map((file) => `### ${file.filename}\n\n${file.markdown}`)
  const extra = leftover?.trim() ?? ""
  if (extra.length > 0) parts.push(extra)
  const joined = parts.join("\n\n")
  return joined.length > max ? joined.slice(0, max) : joined
}

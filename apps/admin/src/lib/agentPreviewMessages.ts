export type PreviewMessage = {
  id: string
  role: "user" | "assistant"
  text: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function textFromParts(parts: unknown[]): string {
  let text = ""
  for (const part of parts) {
    const rec = asRecord(part)
    if (rec?.type === "text" && typeof rec.text === "string") text += rec.text
  }
  return text
}

function textFromMessage(msg: Record<string, unknown>): string {
  if (typeof msg.text === "string") return msg.text
  if (Array.isArray(msg.parts)) return textFromParts(msg.parts)
  if (typeof msg.content === "string") return msg.content
  return ""
}

export function messagesFromPreviewPage(page: unknown): PreviewMessage[] {
  if (!Array.isArray(page)) return []
  return page.flatMap((item, index) => {
    const rec = asRecord(item)
    if (rec === null) return []
    const role = rec.role === "assistant" || rec.role === "user" ? rec.role : null
    if (role === null) return []
    const id = typeof rec.id === "string" && rec.id.length > 0 ? rec.id : `msg-${index}`
    return [{ id, role, text: textFromMessage(rec) }]
  })
}

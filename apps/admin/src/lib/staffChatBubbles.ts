export type StaffChatFile = { url: string; filename: string; mime: string }

export type StaffChatBubble = {
  key: string
  role: "user" | "assistant"
  text: string
  streaming: boolean
  file?: StaffChatFile
}

type UiPart = {
  type: string
  text?: string
  url?: string
  filename?: string
  mediaType?: string
  mime?: string
}

export type StaffUiMessage = {
  key?: string
  order: number
  stepOrder: number
  role: string
  parts: ReadonlyArray<UiPart>
  text?: string
  status?: string
  chatFile?: StaffChatFile
}

function textParts(parts: ReadonlyArray<UiPart>): string[] {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .filter((text) => text.length > 0)
}

function fileFromPart(part: UiPart): StaffChatFile | undefined {
  if (part.type !== "file" && part.type !== "image") return undefined
  if (typeof part.url !== "string" || part.url.length === 0) return undefined
  const mime = part.mediaType ?? part.mime ?? ""
  if (mime.length === 0) return undefined
  const filename = part.filename && part.filename.length > 0 ? part.filename : "image"
  return { url: part.url, filename, mime }
}

function fileFromParts(parts: ReadonlyArray<UiPart>): StaffChatFile | undefined {
  for (const part of parts) {
    const file = fileFromPart(part)
    if (file) return file
  }
  return undefined
}

function attachFileToLast(
  emitted: StaffChatBubble[],
  file: StaffChatFile,
  fallbackKey: string,
  role: "user" | "assistant",
  streaming: boolean,
): void {
  const last = emitted.at(-1)
  if (last && last.file === undefined) {
    emitted[emitted.length - 1] = { ...last, file }
    return
  }
  emitted.push({ key: fallbackKey, role, text: "", streaming, file })
}

export function staffChatBubbles(messages: ReadonlyArray<StaffUiMessage>): StaffChatBubble[] {
  const bubbles: StaffChatBubble[] = []
  for (const message of messages) {
    const role = message.role === "user" || message.role === "assistant" ? message.role : null
    if (!role) continue
    const texts = textParts(message.parts)
    if (texts.length === 0 && message.text && message.text.length > 0) {
      texts.push(message.text)
    }
    const streaming = message.status === "streaming"
    const baseKey = message.key ?? `${message.order}-${message.stepOrder}`
    const file = message.chatFile ?? fileFromParts(message.parts)
    if (role === "user") {
      bubbles.push({
        key: baseKey,
        role,
        text: texts.join(""),
        streaming,
        ...(file ? { file } : {}),
      })
      continue
    }

    const emitted: StaffChatBubble[] = []
    for (const [index, part] of message.parts.entries()) {
      if (part.type === "text") {
        const text = part.text ?? ""
        if (text.length === 0) continue
        emitted.push({
          key: emitted.length === 0 ? baseKey : `${baseKey}-${emitted.length}`,
          role,
          text,
          streaming,
        })
        continue
      }
      const partFile = fileFromPart(part)
      if (!partFile) continue
      attachFileToLast(emitted, partFile, `${baseKey}-file-${index}`, role, streaming)
    }

    if (emitted.length === 0 && texts.length > 0) {
      texts.forEach((text, index) => {
        emitted.push({
          key: texts.length === 1 ? baseKey : `${baseKey}-${index}`,
          role,
          text,
          streaming,
        })
      })
    }

    if (message.chatFile && !emitted.some((bubble) => bubble.file)) {
      if (emitted.length === 0) {
        emitted.push({ key: baseKey, role, text: "", streaming, file: message.chatFile })
      } else {
        emitted[0] = { ...emitted[0]!, file: message.chatFile }
      }
    }

    bubbles.push(...emitted)
  }
  return bubbles
}

import { ALLOWED_MIME_TYPES, MAX_CHAT_FILE_BYTES } from "@astrotan/backend/convex/content"

export const CHAT_FILE_MAX_LABEL = `${MAX_CHAT_FILE_BYTES / (1024 * 1024)} Mo`

export type ChatFileRef = { url: string; filename: string; mime: string }

export function chatFileClientError(file: File): string | null {
  if (file.size > MAX_CHAT_FILE_BYTES) {
    return `Ce fichier dépasse ${CHAT_FILE_MAX_LABEL}.`
  }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Ce type de fichier n'est pas accepté. Envoyez une image (PNG, JPEG, WebP, AVIF ou GIF)."
  }
  return null
}

export function chatFileApiError(code: string): string | null {
  if (code === "file_too_large") return `Ce fichier dépasse ${CHAT_FILE_MAX_LABEL}.`
  if (code === "unsupported_mime" || code === "invalid_file") {
    return "Ce type de fichier n'est pas accepté."
  }
  return null
}

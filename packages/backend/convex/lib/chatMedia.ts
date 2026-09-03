import { ConvexError } from "convex/values"
import type { Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { requireChatSession } from "./chatSession"
import { assertSharedSecret } from "./sharedSecret"
import {
  ALLOWED_MIME_TYPES,
  MAX_CHAT_FILE_BYTES,
  MAX_FILENAME_LENGTH,
} from "../content"

export type ChatFileView = { url: string; filename: string; mime: string }

export function assertChatFileMeta(
  mime: string | undefined,
  size: number,
): { mime: string; size: number } {
  const type = mime ?? ""
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(type)) {
    throw new ConvexError({ code: "UNSUPPORTED_MIME", mime: type })
  }
  if (size > MAX_CHAT_FILE_BYTES) {
    throw new ConvexError({ code: "FILE_TOO_LARGE", max: MAX_CHAT_FILE_BYTES })
  }
  return { mime: type, size }
}

export function assertChatFilename(raw: string): string {
  if (raw.length > MAX_FILENAME_LENGTH) {
    throw new ConvexError({
      code: "FIELD_TOO_LONG",
      field: "filename",
      max: MAX_FILENAME_LENGTH,
    })
  }
  const filename = raw.trim()
  if (filename.length === 0) throw new ConvexError({ code: "INVALID_FILENAME" })
  return filename
}

function mimeFromFilename(filename: string): string | undefined {
  const lower = filename.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".avif")) return "image/avif"
  if (lower.endsWith(".gif")) return "image/gif"
  return undefined
}

export async function readStoredChatFile(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
  filename?: string,
  claimedMime?: string,
): Promise<{ storageId: Id<"_storage">; mime: string; size: number }> {
  const meta = await ctx.db.system.get(storageId)
  if (meta === null) throw new ConvexError({ code: "INVALID_FILE" })
  const stored = meta.contentType && meta.contentType.length > 0 ? meta.contentType : undefined
  const mime = stored ?? claimedMime ?? (filename ? mimeFromFilename(filename) : undefined)
  const checked = assertChatFileMeta(mime, meta.size)
  return { storageId, mime: checked.mime, size: checked.size }
}

export async function persistChatFile(
  ctx: MutationCtx,
  args: {
    threadId: string
    messageId: string
    storageId: Id<"_storage">
    filename: string
    mime: string
    size: number
  },
): Promise<void> {
  await ctx.db.insert("chatFiles", args)
}

type AttachablePart = {
  type: string
  url?: string
  filename?: string
  mediaType?: string
}

type AttachableMessage = {
  id?: string
  key?: string
  parts?: ReadonlyArray<AttachablePart>
}

function hasFilePart(parts: AttachableMessage["parts"]): boolean {
  return (
    parts?.some(
      (part) =>
        (part.type === "file" || part.type === "image") &&
        typeof part.url === "string" &&
        part.url.length > 0,
    ) === true
  )
}

export async function attachChatFilesToPage<T extends AttachableMessage>(
  ctx: QueryCtx,
  threadId: string,
  page: T[],
): Promise<Array<T & { chatFile?: ChatFileView }>> {
  const rows = await ctx.db
    .query("chatFiles")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .collect()
  if (rows.length === 0) return page
  const byMessage = new Map(rows.map((row) => [row.messageId, row]))
  return Promise.all(
    page.map(async (msg) => {
      const row =
        (typeof msg.id === "string" ? byMessage.get(msg.id) : undefined) ??
        (typeof msg.key === "string" ? byMessage.get(msg.key) : undefined)
      if (!row) return msg
      const url = await ctx.storage.getUrl(row.storageId)
      if (!url) return msg
      const chatFile = { url, filename: row.filename, mime: row.mime }
      if (hasFilePart(msg.parts)) return { ...msg, chatFile }
      const parts = [...(msg.parts ?? [])]
      parts.push({ type: "file", url, filename: row.filename, mediaType: row.mime })
      return { ...msg, parts, chatFile }
    }),
  )
}

export async function issueVisitorUploadUrl(
  ctx: MutationCtx,
  args: { secret: string; token: string },
): Promise<string> {
  await assertSharedSecret(args.secret, process.env.LEAD_SUBMIT_SECRET)
  await requireChatSession(ctx, args.token)
  return ctx.storage.generateUploadUrl()
}

export function chatPromptFor(body: string, filename: string | undefined): string {
  if (body.length > 0) return body
  return filename && filename.length > 0 ? filename : "Image"
}

export type ChatTextPart = { type: "text"; text: string }
export type ChatImagePart = { type: "image"; image: string; mediaType: string }
export type ChatUserContent = string | Array<ChatTextPart | ChatImagePart>

export function buildChatUserContent(args: {
  body: string
  filename?: string
  imageUrl?: string | null
  mime?: string
}): ChatUserContent {
  const text = chatPromptFor(args.body, args.filename)
  if (
    typeof args.imageUrl === "string" &&
    args.imageUrl.length > 0 &&
    typeof args.mime === "string" &&
    args.mime.startsWith("image/")
  ) {
    return [
      { type: "text", text },
      { type: "image", image: args.imageUrl, mediaType: args.mime },
    ]
  }
  return text
}

export function chatUserSaveArgs(content: ChatUserContent):
  | { prompt: string }
  | { message: { role: "user"; content: Array<ChatTextPart | ChatImagePart> } } {
  if (typeof content === "string") return { prompt: content }
  return { message: { role: "user", content } }
}

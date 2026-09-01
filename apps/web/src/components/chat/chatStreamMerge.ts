export const POLL_STREAMING_MS = 400
export const POLL_IDLE_MS = 2000

export type DisplayedMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  streaming?: boolean
}

export type StreamCursor = { streamId: string; cursor: number }
export type StreamArgsState =
  | { kind: "list" }
  | { kind: "deltas"; cursors: StreamCursor[] }

export type PollState = {
  messages: DisplayedMessage[]
  streamArgs: StreamArgsState
  intervalMs: number
  draftByStream: Record<string, string>
  cursors: Record<string, number>
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return value as JsonRecord
}

function textFromParts(parts: unknown[]): string {
  let text = ""
  for (const part of parts) {
    const rec = asRecord(part)
    if (rec?.type === "text" && typeof rec.text === "string") text += rec.text
  }
  return text
}

export function textFromDeltaParts(parts: unknown[]): string {
  let text = ""
  for (const part of parts) {
    const rec = asRecord(part)
    if (!rec || rec.type !== "text-delta") continue
    if (typeof rec.delta === "string") text += rec.delta
    else if (typeof rec.text === "string") text += rec.text
  }
  return text
}

export function mergeDeltaText(existing: string, parts: unknown[]): string {
  return existing + textFromDeltaParts(parts)
}

function messageId(msg: JsonRecord, index: number): string {
  if (typeof msg.id === "string" && msg.id.length > 0) return msg.id
  if (typeof msg._id === "string" && msg._id.length > 0) return msg._id
  if (typeof msg.key === "string" && msg.key.length > 0) return msg.key
  return `msg-${index}`
}

function textFromMessage(msg: JsonRecord): string {
  if (typeof msg.text === "string") return msg.text
  if (Array.isArray(msg.parts)) return textFromParts(msg.parts)
  if (typeof msg.content === "string") return msg.content
  if (Array.isArray(msg.content)) return textFromParts(msg.content)
  const inner = asRecord(msg.message)
  return inner ? textFromMessage(inner) : ""
}

export function hasOpenStream(streams: unknown): boolean {
  if (streams == null) return false
  if (Array.isArray(streams)) return streams.length > 0
  if (typeof streams !== "object") return false
  const body = streams as Record<string, unknown>
  if (body.status === "streaming") return true
  if (Array.isArray(body.messages) && body.messages.length > 0) return true
  if (Array.isArray(body.deltas) && body.deltas.length > 0) return true
  return false
}

export function pollIntervalMs(streams: unknown): number {
  return hasOpenStream(streams) ? POLL_STREAMING_MS : POLL_IDLE_MS
}

export function messagesFromPage(page: unknown): DisplayedMessage[] {
  if (!Array.isArray(page)) return []
  const out: DisplayedMessage[] = []
  for (const [index, item] of page.entries()) {
    const msg = asRecord(item)
    if (!msg) continue
    const role = msg.role === "user" || msg.role === "assistant" ? msg.role : null
    if (!role) continue
    out.push({ id: messageId(msg, index), role, text: textFromMessage(msg) })
  }
  return out
}

export function attachDrafts(
  page: DisplayedMessage[],
  drafts: Record<string, string>,
): DisplayedMessage[] {
  const draft = Object.values(drafts).join("")
  if (draft.length === 0) return page
  const assistant = [...page].reverse().find((message) => message.role === "assistant")
  if (assistant && assistant.text.length >= draft.length) return page
  if (assistant && assistant.text.length === 0) {
    return page.map((message) =>
      message.id === assistant.id ? { ...message, text: draft, streaming: true } : message,
    )
  }
  return [...page, { id: "streaming", role: "assistant", text: draft, streaming: true }]
}

export function initialPollState(): PollState {
  return {
    messages: [],
    streamArgs: { kind: "list" },
    intervalMs: POLL_IDLE_MS,
    draftByStream: {},
    cursors: {},
  }
}

function openStreamIds(streams: JsonRecord): string[] {
  if (!Array.isArray(streams.messages)) return []
  const ids: string[] = []
  for (const item of streams.messages) {
    const rec = asRecord(item)
    if (rec?.status === "streaming" && typeof rec.streamId === "string") {
      ids.push(rec.streamId)
    }
  }
  return ids
}

export function reducePoll(prev: PollState, payload: unknown): PollState {
  const body = asRecord(payload) ?? {}
  const page = messagesFromPage(body.page ?? body.results)
  const streams = body.streams
  const drafts = { ...prev.draftByStream }
  const cursors = { ...prev.cursors }
  const streamRec = asRecord(streams)

  if (streamRec?.kind === "deltas" && Array.isArray(streamRec.deltas)) {
    for (const raw of streamRec.deltas) {
      const delta = asRecord(raw)
      if (!delta || typeof delta.streamId !== "string") continue
      const start = typeof delta.start === "number" ? delta.start : 0
      if (start < (cursors[delta.streamId] ?? 0)) continue
      drafts[delta.streamId] = mergeDeltaText(
        drafts[delta.streamId] ?? "",
        Array.isArray(delta.parts) ? delta.parts : [],
      )
      if (typeof delta.end === "number") cursors[delta.streamId] = delta.end
    }
  }

  let streamArgs: StreamArgsState = { kind: "list" }
  if (streamRec?.kind === "list") {
    const ids = openStreamIds(streamRec)
    if (ids.length > 0) {
      streamArgs = {
        kind: "deltas",
        cursors: ids.map((streamId) => ({ streamId, cursor: cursors[streamId] ?? 0 })),
      }
    } else {
      for (const key of Object.keys(drafts)) delete drafts[key]
    }
  } else if (streamRec?.kind === "deltas") {
    const deltas = Array.isArray(streamRec.deltas) ? streamRec.deltas : []
    const ids = Object.keys(cursors)
    if (deltas.length > 0 && ids.length > 0) {
      streamArgs = {
        kind: "deltas",
        cursors: ids.map((streamId) => ({ streamId, cursor: cursors[streamId] ?? 0 })),
      }
    }
  }

  return {
    messages: attachDrafts(page, drafts),
    streamArgs,
    intervalMs:
      hasOpenStream(streams) || streamArgs.kind === "deltas" ? POLL_STREAMING_MS : POLL_IDLE_MS,
    draftByStream: drafts,
    cursors,
  }
}

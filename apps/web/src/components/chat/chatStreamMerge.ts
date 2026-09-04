import {
  STREAM_FALLBACK_ID,
  STREAM_FALLBACK_TEXT,
  STREAM_TEXT_TIMEOUT_MS,
} from "@astrotan/backend/convex/lib/streamTools"

export const POLL_STREAMING_MS = 1_500
export const POLL_IDLE_MS = 14_000
export const PRESENCE_INTERVAL_MS = 25_000
export { STREAM_FALLBACK_ID, STREAM_FALLBACK_TEXT, STREAM_TEXT_TIMEOUT_MS }

export type PollCadenceInput = {
  open: boolean
  pending?: boolean
  streaming?: boolean
  hidden?: boolean
  hasSession?: boolean
}

export type PresenceCadenceInput = {
  open: boolean
  hidden?: boolean
}

export type ChatDisplayedFile = { url: string; filename: string; mime: string }

export type DisplayedMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  streaming?: boolean
  tool?: string
  toolCalls?: string[]
  file?: ChatDisplayedFile
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
  toolsByStream: Record<string, string[]>
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

const TOOL_TYPE_SKIP = new Set([
  "tool-result",
  "tool-error",
  "tool-invocation",
  "tool-input-delta",
  "tool-output-available",
  "tool-output-denied",
  "tool-output-error",
])

function toolNameFromPart(rec: JsonRecord): string | null {
  const nested = asRecord(rec.toolInvocation)
  const raw =
    rec.toolName ?? rec.name ?? rec.tool ?? nested?.toolName ?? nested?.name
  if (typeof raw === "string" && raw.length > 0) return raw
  const type = typeof rec.type === "string" ? rec.type : ""
  if (type.startsWith("tool-") && !TOOL_TYPE_SKIP.has(type) && type !== "tool-call") {
    const suffix = type.slice("tool-".length)
    if (suffix.length > 0 && !TOOL_TYPE_SKIP.has(`tool-${suffix}`) && suffix !== "input-start") {
      return suffix
    }
  }
  return null
}

function isToolPart(rec: JsonRecord): boolean {
  const type = typeof rec.type === "string" ? rec.type : ""
  if (type === "tool-call" || type === "tool-input-start" || type === "dynamic-tool") {
    return true
  }
  if (type === "tool-invocation") return true
  if (type.startsWith("tool-") && !TOOL_TYPE_SKIP.has(type)) return true
  return false
}

export function toolNamesFromParts(parts: unknown[]): string[] {
  const names: string[] = []
  for (const part of parts) {
    const rec = asRecord(part)
    if (!rec || !isToolPart(rec)) continue
    names.push(toolNameFromPart(rec) ?? "outil")
  }
  return [...new Set(names)]
}

function isCalendarTool(name: string): boolean {
  return name.toLowerCase().includes("calendar")
}

export function streamingBusyLabel(messages: readonly DisplayedMessage[]): string {
  const names: string[] = []
  for (const message of messages) {
    if (message.role !== "assistant") continue
    if (message.toolCalls) names.push(...message.toolCalls)
    else if (message.tool) names.push(message.tool)
  }
  if (names.length === 0) return "Réponse en cours…"
  const unique = [...new Set(names.filter((name) => name && name !== "outil"))]
  if (unique.length > 0 && unique.every(isCalendarTool)) {
    return "Consultation de l'agenda…"
  }
  if (unique.length > 1) return "Utilisation d'outils…"
  return "Utilisation d'un outil…"
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

function chatFileFromMessage(msg: JsonRecord): ChatDisplayedFile | undefined {
  const raw = asRecord(msg.chatFile)
  if (!raw) return undefined
  if (typeof raw.url !== "string" || raw.url.length === 0) return undefined
  if (typeof raw.filename !== "string" || typeof raw.mime !== "string") return undefined
  return { url: raw.url, filename: raw.filename, mime: raw.mime }
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

function toolCallsFromMessage(msg: JsonRecord): string[] {
  if (Array.isArray(msg.toolCalls)) {
    return msg.toolCalls.filter((name): name is string => typeof name === "string")
  }
  if (typeof msg.tool === "string" && msg.tool.length > 0) return [msg.tool]
  const parts = Array.isArray(msg.parts)
    ? msg.parts
    : Array.isArray(msg.content)
      ? msg.content
      : []
  const fromParts = toolNamesFromParts(parts)
  if (fromParts.length > 0) return fromParts
  const inner = asRecord(msg.message)
  return inner ? toolCallsFromMessage(inner) : []
}

function isStreaming(item: unknown): boolean {
  return asRecord(item)?.status === "streaming"
}

export function hasOpenStream(streams: unknown): boolean {
  if (streams == null) return false
  if (Array.isArray(streams)) return streams.some(isStreaming)
  if (typeof streams !== "object") return false
  const body = streams as Record<string, unknown>
  if (body.status === "streaming") return true
  if (Array.isArray(body.messages)) return body.messages.some(isStreaming)
  return false
}

export function fallbackIfReplyTimedOut(input: {
  messages: readonly DisplayedMessage[]
  sentAt: number | null
  now: number
  timeoutMs?: number
}): DisplayedMessage | null {
  if (input.sentAt == null) return null
  if (input.now - input.sentAt < (input.timeoutMs ?? STREAM_TEXT_TIMEOUT_MS)) return null
  const last = input.messages.at(-1)
  if (last?.role === "assistant" && last.streaming !== true && last.text.trim().length > 0) {
    return null
  }
  return { id: STREAM_FALLBACK_ID, role: "assistant", text: STREAM_FALLBACK_TEXT }
}

export function pollIntervalMs(input: PollCadenceInput): number | null {
  if (input.hidden) return null
  if (!input.open) return input.hasSession ? POLL_IDLE_MS : null
  if (input.pending || input.streaming) return POLL_STREAMING_MS
  return POLL_IDLE_MS
}

export function presenceIntervalMs(input: PresenceCadenceInput): number | null {
  // Présence = l'onglet est visible, pas « le widget est ouvert ».
  if (input.hidden) return null
  return PRESENCE_INTERVAL_MS
}

export function messagesFromPage(page: unknown): DisplayedMessage[] {
  if (!Array.isArray(page)) return []
  const out: DisplayedMessage[] = []
  for (const [index, item] of page.entries()) {
    const msg = asRecord(item)
    if (!msg) continue
    const role = msg.role === "user" || msg.role === "assistant" ? msg.role : null
    if (!role) continue
    const file = chatFileFromMessage(msg)
    const toolCalls = toolCallsFromMessage(msg)
    out.push({
      id: messageId(msg, index),
      role,
      text: textFromMessage(msg),
      ...(msg.status === "streaming" ? { streaming: true } : {}),
      ...(toolCalls.length === 1 ? { tool: toolCalls[0] } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(file ? { file } : {}),
    })
  }
  return out
}

export function applyVisitorSnapshot(
  poll: PollState,
  snapshot: { page?: unknown; hasLead?: boolean; staffOnline?: boolean },
): { poll: PollState; hasLead: boolean; staffOnline: boolean } {
  const page = messagesFromPage(snapshot.page)
  const last = page.at(-1)
  const staffLanded =
    last?.role === "assistant" && last.streaming !== true && last.text.trim().length > 0
  return {
    poll: {
      ...poll,
      messages: staffLanded ? page : attachDrafts(page, poll.draftByStream, poll.toolsByStream),
    },
    hasLead: snapshot.hasLead === true,
    staffOnline: snapshot.staffOnline === true,
  }
}

function mergeToolCalls(
  existing?: string[],
  extra?: string[],
): { tool?: string; toolCalls?: string[] } {
  const names = [...new Set([...(existing ?? []), ...(extra ?? [])])]
  if (names.length === 0) return {}
  return {
    ...(names.length === 1 ? { tool: names[0] } : {}),
    toolCalls: names,
  }
}

export function attachDrafts(
  page: DisplayedMessage[],
  drafts: Record<string, string>,
  toolsByStream: Record<string, string[]> = {},
): DisplayedMessage[] {
  const draft = Object.values(drafts).join("")
  const streamTools = [...new Set(Object.values(toolsByStream).flat())]
  if (draft.length === 0 && streamTools.length === 0) return page
  const assistant = [...page].reverse().find((message) => message.role === "assistant")
  const tools = mergeToolCalls(assistant?.toolCalls, streamTools)
  if (assistant && draft.length > 0 && assistant.text.length >= draft.length) {
    return page.map((message) =>
      message.id === assistant.id ? { ...message, streaming: true, ...tools } : message,
    )
  }
  if (assistant && assistant.text.length === 0) {
    return page.map((message) =>
      message.id === assistant.id
        ? { ...message, text: draft, streaming: true, ...tools }
        : message,
    )
  }
  if (draft.length === 0 && assistant) {
    return page.map((message) =>
      message.id === assistant.id ? { ...message, streaming: true, ...tools } : message,
    )
  }
  return [
    ...page,
    { id: "streaming", role: "assistant", text: draft, streaming: true, ...tools },
  ]
}

export function initialPollState(): PollState {
  return {
    messages: [],
    streamArgs: { kind: "list" },
    intervalMs: POLL_IDLE_MS,
    draftByStream: {},
    toolsByStream: {},
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
  const toolsByStream = { ...prev.toolsByStream }
  const cursors = { ...prev.cursors }
  const streamRec = asRecord(streams)
  let cursorAdvanced = false

  if (streamRec?.kind === "deltas" && Array.isArray(streamRec.deltas)) {
    for (const raw of streamRec.deltas) {
      const delta = asRecord(raw)
      if (!delta || typeof delta.streamId !== "string") continue
      const start = typeof delta.start === "number" ? delta.start : 0
      if (start < (cursors[delta.streamId] ?? 0)) continue
      const parts = Array.isArray(delta.parts) ? delta.parts : []
      drafts[delta.streamId] = mergeDeltaText(drafts[delta.streamId] ?? "", parts)
      const toolNames = toolNamesFromParts(parts)
      if (toolNames.length > 0) {
        toolsByStream[delta.streamId] = [
          ...new Set([...(toolsByStream[delta.streamId] ?? []), ...toolNames]),
        ]
      }
      if (typeof delta.end === "number") {
        if (delta.end > (cursors[delta.streamId] ?? 0)) cursorAdvanced = true
        cursors[delta.streamId] = delta.end
      }
    }
  }

  let streamArgs: StreamArgsState = { kind: "list" }
  if (streamRec?.kind === "list") {
    const ids = openStreamIds(streamRec)
    if (ids.length > 0) {
      for (const streamId of ids) {
        if (cursors[streamId] === undefined) cursors[streamId] = 0
      }
      streamArgs = {
        kind: "deltas",
        cursors: ids.map((streamId) => ({ streamId, cursor: cursors[streamId] ?? 0 })),
      }
    } else {
      for (const key of Object.keys(drafts)) delete drafts[key]
      for (const key of Object.keys(toolsByStream)) delete toolsByStream[key]
      for (const key of Object.keys(cursors)) delete cursors[key]
    }
  } else if (streamRec?.kind === "deltas") {
    const ids = Object.keys(cursors)
    // Un delta `start` rejoué (cursor déjà passé) n'est pas du texte :
    // rester en `deltas` pollait à 400 ms jusqu'au timeout Convex → 503.
    if (cursorAdvanced && ids.length > 0) {
      streamArgs = {
        kind: "deltas",
        cursors: ids.map((streamId) => ({ streamId, cursor: cursors[streamId] ?? 0 })),
      }
    }
  }

  const midStreamQuietTick =
    streamRec?.kind === "deltas" && Object.keys(cursors).length > 0

  return {
    messages: attachDrafts(page, drafts, toolsByStream),
    streamArgs,
    intervalMs:
      hasOpenStream(streams) || streamArgs.kind === "deltas" || midStreamQuietTick
        ? POLL_STREAMING_MS
        : POLL_IDLE_MS,
    draftByStream: drafts,
    toolsByStream,
    cursors,
  }
}

import { ConvexError } from "convex/values"
import { MAX_AGENT_TEASER } from "../content"

/** Noir du chrome actuel (`oklch(0.205 0 0)` ≈ #171717). */
export const DEFAULT_AGENT_CHAT_COLOR = "#171717"

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function normalizeAgentChatColor(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return ""
  const match = HEX.exec(trimmed)
  if (!match) return null
  const raw = match[1] ?? ""
  if (raw.length === 3) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`.toLowerCase()
  }
  return `#${raw}`.toLowerCase()
}

export function assertAgentChatColor(value: string): string {
  const normalized = normalizeAgentChatColor(value)
  if (normalized === null) {
    throw new ConvexError({ code: "INVALID_AGENT_CHAT_COLOR" })
  }
  return normalized
}

export function assertAgentTeaser(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length > MAX_AGENT_TEASER) {
    throw new ConvexError({
      code: "FIELD_TOO_LONG",
      field: "agentTeaser",
      max: MAX_AGENT_TEASER,
    })
  }
  return trimmed
}

export function resolveAgentChatColor(value: string | null | undefined): string {
  if (value == null) return DEFAULT_AGENT_CHAT_COLOR
  return normalizeAgentChatColor(value) || DEFAULT_AGENT_CHAT_COLOR
}

export function chatAccentForeground(hex: string): string {
  const color = resolveAgentChatColor(hex)
  const r = Number.parseInt(color.slice(1, 3), 16)
  const g = Number.parseInt(color.slice(3, 5), 16)
  const b = Number.parseInt(color.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.55 ? "#171717" : "#fafafa"
}

export function visibleChatTeaser(
  teaser: string | null | undefined,
  open: boolean,
): string | null {
  if (open) return null
  const text = teaser?.trim() ?? ""
  return text.length > 0 ? text : null
}

import { ConvexError } from "convex/values"

export function repairTrailingCommas(text: string): string {
  return text.replace(/,\s*(?=[}\]])/g, "")
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function balancedObject(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (c === "\\") {
        escape = true
        continue
      }
      if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      continue
    }
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function looksLikeDraft(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.seoTitle === "string" ||
    typeof obj.seoDescription === "string" ||
    typeof obj.geoSummary === "string" ||
    (obj.seo !== null && typeof obj.seo === "object") ||
    (obj.geo !== null && typeof obj.geo === "object")
  )
}

export function extractJsonCandidates(text: string): string[] {
  const trimmed = text.trim()
  const out: string[] = []
  const fenceRe = /```(?:json)?\s*([\s\S]*?)\s*```/gi
  for (const match of trimmed.matchAll(fenceRe)) {
    if (match[1]) out.push(match[1].trim())
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) out.push(trimmed)
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== "{") continue
    const slice = balancedObject(trimmed, i)
    if (slice) out.push(slice)
  }
  return unique(out)
}

export function extractJsonText(text: string): string {
  return extractJsonCandidates(text)[0] ?? text.trim()
}

export function parseModelJson(text: string): unknown {
  const candidates = extractJsonCandidates(text)
  const parsed: unknown[] = []
  for (const raw of candidates) {
    try {
      parsed.push(JSON.parse(repairTrailingCommas(raw)) as unknown)
    } catch {
      continue
    }
  }
  const draft = parsed.find(looksLikeDraft)
  if (draft !== undefined) return draft
  if (parsed[0] !== undefined) return parsed[0]
  throw new ConvexError({ code: "OPENROUTER_BAD_RESPONSE", reason: "parse" })
}

function textsFromParts(content: unknown[]): string[] {
  const texts: string[] = []
  for (const part of content) {
    if (typeof part === "string") texts.push(part)
    else if (part && typeof part === "object") {
      const rec = part as { text?: unknown; content?: unknown }
      if (typeof rec.text === "string") texts.push(rec.text)
      else if (typeof rec.content === "string") texts.push(rec.content)
    }
  }
  return texts
}

export function contentFromChoice(payload: unknown): string {
  const choices = (payload as { choices?: unknown } | null)?.choices
  const first = Array.isArray(choices) ? choices[0] : undefined
  const message = (first as { message?: Record<string, unknown> } | undefined)
    ?.message
  if (message && typeof message.parsed === "object" && message.parsed !== null) {
    return JSON.stringify(message.parsed)
  }
  const content = message?.content
  if (typeof content === "string" && content.trim().length > 0) return content
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return JSON.stringify(content)
  }
  if (Array.isArray(content)) {
    const joined = textsFromParts(content).join("\n").trim()
    if (joined.length > 0) return joined
  }
  const reasoning = message?.reasoning ?? message?.reasoning_content
  if (typeof reasoning === "string" && reasoning.trim().length > 0) {
    return reasoning
  }
  const text = (first as { text?: unknown } | undefined)?.text
  if (typeof text === "string" && text.trim().length > 0) return text
  throw new ConvexError({ code: "OPENROUTER_BAD_RESPONSE", reason: "parse" })
}

export function isChatEnvelope(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray((value as { choices?: unknown }).choices)
  )
}

export function stripSse(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith("data:")) return text
  const parts: string[] = []
  for (const line of trimmed.split(/\r?\n/)) {
    const match = line.match(/^data:\s?(.*)$/)
    if (!match) continue
    if (match[1] === "[DONE]") continue
    parts.push(match[1])
  }
  return parts.length > 0 ? parts.join("\n") : text
}

export function jsonDepuisReponse(text: string): unknown {
  const stripped = stripSse(text)
  let payload: unknown
  try {
    payload = JSON.parse(stripped)
  } catch {
    payload = parseModelJson(stripped)
  }
  if (isChatEnvelope(payload)) {
    return parseModelJson(contentFromChoice(payload))
  }
  return payload
}

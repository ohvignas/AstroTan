import type { StreamArgsState } from "./chatStreamMerge"

export type ChatOk = { ok: true; data: Record<string, unknown> }
export type ChatFail = { ok: false; code: string }
export type ChatResult = ChatOk | ChatFail

async function readBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json()
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>
    }
  } catch {
    // corps vide ou non JSON
  }
  return {}
}

function asResult(response: Response, body: Record<string, unknown>): ChatResult {
  if (response.ok && body.code === undefined) return { ok: true, data: body }
  const code = typeof body.code === "string" ? body.code : "indisponible"
  return { ok: false, code }
}

export async function startChat(input: {
  email: string
  name: string
  site_web: string
}): Promise<ChatResult> {
  const response = await fetch("/api/chat/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  return asResult(response, await readBody(response))
}

export async function sendChatMessage(token: string, body: string): Promise<ChatResult> {
  const response = await fetch("/api/chat/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, body }),
  })
  return asResult(response, await readBody(response))
}

export async function listChatMessages(
  token: string,
  streamArgs: StreamArgsState,
): Promise<ChatResult> {
  const url = new URL("/api/chat/messages", window.location.origin)
  url.searchParams.set("token", token)
  url.searchParams.set("streamArgs", JSON.stringify(streamArgs))
  const response = await fetch(url)
  return asResult(response, await readBody(response))
}

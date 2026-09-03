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

let startInFlight: Promise<ChatResult> | null = null

async function postStart(input: {
  email?: string
  name?: string
  site_web?: string
}): Promise<ChatResult> {
  const response = await fetch("/api/chat/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  return asResult(response, await readBody(response))
}

export async function startChat(input: {
  email?: string
  name?: string
  site_web?: string
} = {}): Promise<ChatResult> {
  if (startInFlight) return startInFlight
  startInFlight = postStart(input).finally(() => {
    startInFlight = null
  })
  return startInFlight
}

export async function attachChatEmail(input: {
  token: string
  email: string
  name?: string
  site_web?: string
}): Promise<ChatResult> {
  const response = await fetch("/api/chat/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  return asResult(response, await readBody(response))
}

export async function requestChatUploadUrl(token: string): Promise<ChatResult> {
  const response = await fetch("/api/chat/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  })
  return asResult(response, await readBody(response))
}

export async function uploadChatFile(uploadUrl: string, file: File): Promise<ChatResult> {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  })
  return asResult(response, await readBody(response))
}

export async function sendChatWithOptionalFile(
  token: string,
  body: string,
  file: File | undefined,
): Promise<ChatResult> {
  if (!file) return sendChatMessage(token, body)
  const urlResult = await requestChatUploadUrl(token)
  if (!urlResult.ok) return urlResult
  const uploadUrl = urlResult.data.uploadUrl
  if (typeof uploadUrl !== "string" || uploadUrl.length === 0) {
    return { ok: false, code: "indisponible" }
  }
  const uploaded = await uploadChatFile(uploadUrl, file)
  if (!uploaded.ok) return uploaded
  const storageId = uploaded.data.storageId
  if (typeof storageId !== "string" || storageId.length === 0) {
    return { ok: false, code: "indisponible" }
  }
  return sendChatMessage(token, body, {
    storageId,
    filename: file.name,
    mime: file.type,
  })
}

export async function sendChatMessage(
  token: string,
  body: string,
  attachment?: { storageId: string; filename: string; mime?: string },
): Promise<ChatResult> {
  const response = await fetch("/api/chat/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      body,
      ...(attachment ?? {}),
    }),
  })
  return asResult(response, await readBody(response))
}

export async function pingChatPresence(token: string): Promise<ChatResult> {
  const response = await fetch("/api/chat/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
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

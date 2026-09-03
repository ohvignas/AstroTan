import { timingSafeEqualHex } from "./previewToken"

export const CHAT_SESSION_TTL_MS = 24 * 60 * 60 * 1000
export const ANON_SESSION_LEAD = "-"

const MIN_CHAT_SESSION_SECRET_LENGTH = 32

// Lu dans les fonctions, jamais mis en cache au chargement du module :
// un secret absent ou trop court doit jeter, pas dégrader en silence.
function getChatSessionSecret(): string {
  const secret = process.env.CHAT_SESSION_SECRET
  if (!secret) {
    throw new Error("CHAT_SESSION_SECRET is not set on this Convex deployment")
  }
  if (secret.length < MIN_CHAT_SESSION_SECRET_LENGTH) {
    throw new Error(
      `CHAT_SESSION_SECRET must be at least ${MIN_CHAT_SESSION_SECRET_LENGTH} characters`,
    )
  }
  return secret
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))
  return hex(new Uint8Array(signature))
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(segment: string): string | null {
  if (segment.length === 0 || !/^[A-Za-z0-9_-]+$/.test(segment)) return null
  let padded = segment.replace(/-/g, "+").replace(/_/g, "/")
  const rem = padded.length % 4
  if (rem === 1) return null
  if (rem > 0) padded += "=".repeat(4 - rem)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

function buildMessage(leadId: string, threadId: string, expiresAt: number): string {
  return `chatSession:${leadId}:${threadId}:${expiresAt}`
}

export async function signChatSessionToken(params: {
  leadId: string
  threadId: string
  expiresAt: number
}): Promise<string> {
  const secret = getChatSessionSecret()
  const signature = await hmacHex(
    secret,
    buildMessage(params.leadId, params.threadId, params.expiresAt),
  )
  return `${params.expiresAt}.${toBase64Url(params.leadId)}.${toBase64Url(params.threadId)}.${signature}`
}

export async function verifyChatSessionToken(
  token: string,
  now = Date.now(),
): Promise<{ leadId: string; threadId: string; expiresAt: number } | null> {
  const secret = getChatSessionSecret()

  const parts = token.split(".")
  if (parts.length !== 4) return null
  const [expPart, leadPart, threadPart, sigPart] = parts
  if (!expPart || !leadPart || !threadPart || !sigPart) return null
  if (!/^\d+$/.test(expPart)) return null
  const expiresAt = Number(expPart)
  if (!Number.isFinite(expiresAt)) return null

  const leadId = fromBase64Url(leadPart)
  const threadId = fromBase64Url(threadPart)
  if (leadId === null || threadId === null) return null

  const expected = await hmacHex(secret, buildMessage(leadId, threadId, expiresAt))
  if (!timingSafeEqualHex(sigPart, expected)) return null

  if (!(now < expiresAt)) return null
  return { leadId, threadId, expiresAt }
}

import { timingSafeEqualHex } from "./previewToken"

// Vérification de `Stripe-Signature`, sans le SDK.
//
// Format : `t=<unix>,v1=<hex>[,v1=…]`. Le message signé est
// `${t}.${payload}` en HMAC-SHA-256. Une signature trop vieille (5 min)
// est refusée : un corps rejoué plus tard ne passe pas.

const TOLERANCE_MS = 5 * 60 * 1000

export function parseStripeSignature(header: string): {
  timestamp: number
  signatures: string[]
} | null {
  let timestamp = NaN
  const signatures: string[] = []
  for (const part of header.split(",")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === "t") timestamp = Number(value)
    if (key === "v1" && value.length > 0) signatures.push(value)
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return null
  return { timestamp, signatures }
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  )
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function verifyStripeSignature(args: {
  secret: string
  payload: string
  header: string
  now?: number
}): Promise<boolean> {
  const parsed = parseStripeSignature(args.header)
  if (parsed === null) return false
  const now = args.now ?? Date.now()
  if (Math.abs(now - parsed.timestamp * 1000) > TOLERANCE_MS) return false
  const expected = await hmacHex(args.secret, `${parsed.timestamp}.${args.payload}`)
  return parsed.signatures.some((candidate) => timingSafeEqualHex(candidate, expected))
}

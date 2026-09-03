// Helpers partagés des portes `/api/chat/*`. Le `_` exclut ce fichier
// du routage Astro — un `door.ts` ici deviendrait `/api/chat/door`.
import {
  MAX_LEAD_BODY_LENGTH,
  MAX_LEAD_EMAIL_LENGTH,
  MAX_LEAD_NAME_LENGTH,
} from "@astrotan/backend/convex/content"
import { adresseDuVisiteur } from "../../../lib/allowedDomains"
import { geoFromTrustedIp, type VisitorGeo } from "../../../lib/visitorGeo"
import { verifyChatSessionToken } from "../../../lib/chatSessionToken"

export const HONEYPOT_FIELD = "site_web"

const MAX_BODY_BYTES = MAX_LEAD_NAME_LENGTH + MAX_LEAD_EMAIL_LENGTH + MAX_LEAD_BODY_LENGTH + 2_048

const CONVEX_CODES: Record<string, { code: string; status: number }> = {
  INVALID_SESSION: { code: "session", status: 401 },
  RATE_LIMITED: { code: "rate", status: 429 },
  AGENT_DISABLED: { code: "disabled", status: 403 },
  AGENT_UNCONFIGURED: { code: "unconfigured", status: 503 },
  INVALID_EMAIL: { code: "invalid_email", status: 400 },
  EMPTY: { code: "empty", status: 400 },
  TOO_LONG: { code: "too_long", status: 400 },
  FILE_TOO_LARGE: { code: "file_too_large", status: 400 },
  UNSUPPORTED_MIME: { code: "unsupported_mime", status: 400 },
  INVALID_FILE: { code: "invalid_file", status: 400 },
  INVALID_FILENAME: { code: "too_long", status: 400 },
  FIELD_TOO_LONG: { code: "too_long", status: 400 },
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

export function jsonCode(code: string, status: number): Response {
  return json({ code }, status)
}

export function honeypotOk(): Response {
  return json({ ok: true })
}

export function leadSubmitSecret(): string | null {
  const secret = process.env.LEAD_SUBMIT_SECRET
  return secret && secret.length > 0 ? secret : null
}

export function isBodyTooLong(request: Request): boolean {
  return Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const payload: unknown = await request.json()
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null
    return payload as Record<string, unknown>
  } catch {
    return null
  }
}

export function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === "string" ? value : ""
}

export function honeypotFilled(payload: Record<string, unknown>): boolean {
  return stringField(payload, HONEYPOT_FIELD).length > 0
}

async function empreinteOrigine(adresse: string, secret: string): Promise<string> {
  const octets = new TextEncoder().encode(`${adresse}|${secret}`)
  const digest = await crypto.subtle.digest("SHA-256", octets)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function visitorOrigin(
  ctx: { request: Request; clientAddress: string },
  secret: string,
): Promise<string> {
  return empreinteOrigine(await adresseDuVisiteur(ctx), secret)
}

export async function visitorClient(
  ctx: { request: Request; clientAddress: string },
  secret: string,
): Promise<{ origin: string } & VisitorGeo> {
  const ip = await adresseDuVisiteur(ctx)
  return { origin: await empreinteOrigine(ip, secret), ...geoFromTrustedIp(ip, ctx.request.headers) }
}

function convexCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object" || !("data" in error)) return undefined
  const data = (error as { data?: unknown }).data
  if (typeof data !== "object" || data === null || !("code" in data)) return undefined
  const code = (data as { code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

// Mappe un refus Convex vers `{ code }` court. Jamais `error.message` :
// le client HTTP y met parfois l'URL Convex, et jamais un fragment de jeton.
export function mapConvexError(error: unknown): Response {
  const raw = convexCode(error)
  if (raw !== undefined && raw in CONVEX_CODES) {
    const mapped = CONVEX_CODES[raw]!
    return jsonCode(mapped.code, mapped.status)
  }
  return jsonCode("indisponible", 503)
}

export function requireVisitorSession(
  token: string,
): { ok: true } | { ok: false; response: Response } {
  if (token.length === 0) return { ok: false, response: jsonCode("session", 401) }
  try {
    const session = verifyChatSessionToken(token)
    if (session === null) return { ok: false, response: jsonCode("session", 401) }
    return { ok: true }
  } catch {
    return { ok: false, response: jsonCode("indisponible", 503) }
  }
}

export function guardWrite(request: Request): Response | { secret: string } {
  const secret = leadSubmitSecret()
  if (!secret) return jsonCode("indisponible", 503)
  if (isBodyTooLong(request)) return jsonCode("too_long", 400)
  return { secret }
}

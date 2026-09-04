import { ConvexError } from "convex/values"

const STATUTS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SLUG_ALREADY_EXISTS: 409,
  SLUG_TAKEN: 409,
  FIELD_TOO_LONG: 400,
  INVALID_TITLE: 400,
  INVALID_SLUG: 400,
  INVALID_NAME: 400,
  DUPLICATE_TAG: 400,
  UNKNOWN_TAG: 400,
  UNKNOWN_MEDIA: 400,
  TAG_IN_USE: 400,
  EMPTY_SECRET: 400,
}

export function statusForCode(code: string): number {
  return STATUTS[code] ?? 500
}

export function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  }
}

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() },
  })
}

export function jsonError(error: unknown): Response {
  if (error instanceof ConvexError) {
    const data = error.data
    const code =
      typeof data === "object" && data !== null && "code" in data
        ? String((data as { code: unknown }).code)
        : "ERROR"
    return json({ error: code }, statusForCode(code))
  }
  return json({ error: "INTERNAL" }, 500)
}

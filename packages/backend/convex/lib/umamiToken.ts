// The Umami session token, and the only place it is held.
//
// Self-hosted Umami authenticates by JWT through `/api/auth/login`, not by
// API key — that mechanism is Cloud-only. So reading a single statistic
// means putting a username and password on the wire, and the token that
// comes back is what spares us from doing it again.
//
// Its own module for two reasons. The cache is process-wide mutable state,
// which is exactly the kind of thing that should be reachable and clearable
// rather than hidden inside a handler; and a test that asserts "the token
// was reused" is only meaningful if the previous test's token can be
// cleared first.

export interface UmamiConfig {
  url: string
  websiteId: string
  username: string
  password: string
}

/**
 * Well under Umami's own session lifetime, so the token is renewed on our
 * schedule rather than discovered stale mid-request.
 */
const TOKEN_TTL_MS = 30 * 60 * 1000

let cached: { value: string; expiresAt: number } | null = null

/** Read the four variables, or `null` if any is missing. */
export function readUmamiConfig(
  env: Record<string, string | undefined>
): UmamiConfig | null {
  const url = env.UMAMI_URL?.replace(/\/$/, "")
  const websiteId = env.UMAMI_WEBSITE_ID
  const username = env.UMAMI_USERNAME
  const password = env.UMAMI_PASSWORD
  // All four or nothing: a half-configured integration fails at the call
  // site with a confusing error, where "not configured" is a clear answer.
  if (!url || !websiteId || !username || !password) return null
  return { url, websiteId, username, password }
}

export function clearUmamiToken(): void {
  cached = null
}

/**
 * A usable token, from cache when one is valid.
 *
 * Returns `null` rather than throwing when Umami refuses the credentials:
 * the caller turns that into a readable status, and a rejected password is
 * not an exceptional condition — it is the expected state of a deployment
 * whose operator changed it and did not update Convex.
 */
export async function getUmamiToken(
  cfg: UmamiConfig,
  now: number
): Promise<string | null> {
  if (cached !== null && cached.expiresAt > now) return cached.value

  const response = await fetch(`${cfg.url}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: cfg.username, password: cfg.password }),
    // Bounded: a hanging analytics call must not hold a dashboard render.
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) return null

  const body = (await response.json()) as { token?: string }
  if (!body.token) return null

  cached = { value: body.token, expiresAt: now + TOKEN_TTL_MS }
  return body.token
}

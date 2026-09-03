export class GoogleOAuthError extends Error {
  code = "CALENDAR_DISCONNECTED" as const
}

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ")

export function sourceDuNom(
  nom: "GOOGLE_CALENDAR_CLIENT_SECRET" | "GOOGLE_CALENDAR_REFRESH_TOKEN",
  rowPresent: boolean,
): "environnement" | "base" | "aucune" {
  if (process.env[nom]) return "environnement"
  if (rowPresent) return "base"
  return "aucune"
}

export function buildGoogleAuthUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_CALENDAR_SCOPES,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeGoogleCode(args: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<{ refreshToken: string; accessToken: string | null }> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
      grant_type: "authorization_code",
    }),
  })
  if (!response.ok) throw new GoogleOAuthError()
  const json: unknown = await response.json()
  if (typeof json !== "object" || json === null) throw new GoogleOAuthError()
  const refresh =
    "refresh_token" in json && typeof json.refresh_token === "string"
      ? json.refresh_token
      : ""
  if (refresh.length === 0) throw new GoogleOAuthError()
  const access =
    "access_token" in json && typeof json.access_token === "string"
      ? json.access_token
      : null
  return { refreshToken: refresh, accessToken: access }
}

export async function readPrimaryCalendarEmail(
  accessToken: string,
): Promise<string | null> {
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary",
    { headers: { authorization: `Bearer ${accessToken}` } },
  )
  if (!response.ok) return null
  const json: unknown = await response.json()
  if (typeof json !== "object" || json === null) return null
  const id = "id" in json && typeof json.id === "string" ? json.id.trim() : ""
  return id.length > 0 ? id : null
}

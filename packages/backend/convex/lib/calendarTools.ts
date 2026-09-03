import { createTool } from "@convex-dev/agent"
import { z } from "zod"
import { internal } from "../_generated/api"
import { CALENDAR_WINDOW_MS } from "../content"
import { lireSecret } from "../secrets"
import type { ActionCtx } from "../_generated/server"

type CalendarResult =
  | { code: "CALENDAR_DISCONNECTED" }
  | { code: "WINDOW_TOO_LARGE" }
  | { ok: true; data: unknown }

async function googleAccessToken(ctx: ActionCtx): Promise<string | null> {
  const refresh = await lireSecret(ctx, "GOOGLE_CALENDAR_REFRESH_TOKEN")
  const secret = await lireSecret(ctx, "GOOGLE_CALENDAR_CLIENT_SECRET")
  const config = await ctx.runQuery(internal.connectors.googleConfig, {})
  if (!refresh || !secret || !config.clientId) return null
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: config.clientId,
    client_secret: secret,
  })
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!response.ok) return null
  const json: unknown = await response.json()
  if (typeof json !== "object" || json === null || !("access_token" in json)) return null
  const token = (json as { access_token?: unknown }).access_token
  return typeof token === "string" ? token : null
}

export function assertCalendarWindow(timeMin: string, timeMax: string): boolean {
  const start = Date.parse(timeMin)
  const end = Date.parse(timeMax)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return false
  return end - start <= CALENDAR_WINDOW_MS
}

export const calendarFreeBusy = createTool({
  description: "Créneaux occupés sur les 14 prochains jours.",
  inputSchema: z.object({
    timeMin: z.string(),
    timeMax: z.string(),
  }),
  execute: async (ctx, input): Promise<CalendarResult> => {
    if (!assertCalendarWindow(input.timeMin, input.timeMax)) {
      return { code: "WINDOW_TOO_LARGE" }
    }
    const access = await googleAccessToken(ctx)
    if (!access) return { code: "CALENDAR_DISCONNECTED" }
    const config = await ctx.runQuery(internal.connectors.googleConfig, {})
    const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        authorization: `Bearer ${access}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        items: [{ id: config.calendarId }],
      }),
    })
    if (!response.ok) return { code: "CALENDAR_DISCONNECTED" }
    return { ok: true, data: await response.json() }
  },
})

export const calendarCreateEvent = createTool({
  description: "Crée un événement et invite l'e-mail du lead de ce fil.",
  inputSchema: z.object({
    summary: z.string(),
    start: z.string(),
    end: z.string(),
  }),
  execute: async (ctx, input): Promise<CalendarResult> => {
    const access = await googleAccessToken(ctx)
    if (!access) return { code: "CALENDAR_DISCONNECTED" }
    const email: string | null = await ctx.runQuery(internal.chatStream.leadEmailForThread, {
      threadId: ctx.threadId ?? "",
    })
    if (!email) return { code: "CALENDAR_DISCONNECTED" }
    const config = await ctx.runQuery(internal.connectors.googleConfig, {})
    const calendarId = encodeURIComponent(config.calendarId)
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          summary: input.summary,
          start: { dateTime: input.start },
          end: { dateTime: input.end },
          attendees: [{ email }],
        }),
      },
    )
    if (!response.ok) return { code: "CALENDAR_DISCONNECTED" }
    return { ok: true, data: await response.json() }
  },
})

export const calendarTools = {
  calendarFreeBusy,
  calendarCreateEvent,
}

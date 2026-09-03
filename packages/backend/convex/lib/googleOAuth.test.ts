import { afterEach, expect, test, vi } from "vitest"
import { exchangeGoogleCode, readPrimaryCalendarEmail } from "./googleOAuth"

afterEach(() => {
  vi.unstubAllGlobals()
})

test("exchangeGoogleCode refuse une réponse sans refresh_token", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ access_token: "a" }), { status: 200 })),
  )
  await expect(
    exchangeGoogleCode({
      code: "x",
      clientId: "id.apps.googleusercontent.com",
      clientSecret: "s",
      redirectUri: "http://localhost:3001/api/connectors/google/callback",
    }),
  ).rejects.toMatchObject({ code: "CALENDAR_DISCONNECTED" })
})

test("readPrimaryCalendarEmail lit id sur calendars/primary", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ id: "marie@cabinet.fr" }), { status: 200 }),
    ),
  )
  await expect(readPrimaryCalendarEmail("access")).resolves.toBe("marie@cabinet.fr")
})

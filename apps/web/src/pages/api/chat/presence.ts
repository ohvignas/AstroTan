export const prerender = false

import type { APIRoute } from "astro"
import { api } from "@astrotan/backend/convex/_generated/api"
import { getConvexClient } from "../../../lib/convexClient"
import {
  guardWrite,
  honeypotFilled,
  honeypotOk,
  json,
  jsonCode,
  mapConvexError,
  readJson,
  requireVisitorSession,
  stringField,
} from "./_door"

export const POST: APIRoute = async ({ request }) => {
  const gate = guardWrite(request)
  if (gate instanceof Response) return gate

  const payload = await readJson(request)
  if (payload === null) return jsonCode("empty", 400)
  if (honeypotFilled(payload)) return honeypotOk()

  const token = stringField(payload, "token")
  const session = requireVisitorSession(token)
  if (!session.ok) return session.response

  try {
    const result = await getConvexClient().mutation(api.chat.visitorHeartbeat, {
      secret: gate.secret,
      token,
    })
    return json({ ok: true, ...result })
  } catch (error) {
    return mapConvexError(error)
  }
}

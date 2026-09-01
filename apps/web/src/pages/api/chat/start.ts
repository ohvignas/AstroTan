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
  stringField,
  visitorOrigin,
} from "./_door"

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const gate = guardWrite(request)
  if (gate instanceof Response) return gate

  const payload = await readJson(request)
  if (payload === null) return jsonCode("empty", 400)
  if (honeypotFilled(payload)) return honeypotOk()

  const email = stringField(payload, "email")
  const name = stringField(payload, "name")
  const origin = await visitorOrigin({ request, clientAddress }, gate.secret)

  try {
    const result = await getConvexClient().mutation(api.chat.start, {
      secret: gate.secret,
      origin,
      email,
      name: name.length > 0 ? name : undefined,
    })
    return json({ ok: true, ...result })
  } catch (error) {
    return mapConvexError(error)
  }
}

export const prerender = false

import type { APIRoute } from "astro"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
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
  visitorOrigin,
  visitorPageUrl,
} from "./_door"

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const gate = guardWrite(request)
  if (gate instanceof Response) return gate

  const payload = await readJson(request)
  if (payload === null) return jsonCode("empty", 400)
  if (honeypotFilled(payload)) return honeypotOk()

  const token = stringField(payload, "token")
  const session = requireVisitorSession(token)
  if (!session.ok) return session.response

  const body = stringField(payload, "body")
  const storageId = stringField(payload, "storageId")
  const filename = stringField(payload, "filename")
  const mime = stringField(payload, "mime")
  const origin = await visitorOrigin({ request, clientAddress }, gate.secret)

  try {
    const result = await getConvexClient().mutation(api.chat.send, {
      secret: gate.secret,
      token,
      body,
      origin,
      ...(storageId.length > 0
        ? {
            storageId: storageId as Id<"_storage">,
            filename: filename || "image",
            ...(mime.length > 0 ? { mime } : {}),
          }
        : {}),
      pageUrl: visitorPageUrl(request, payload),
    })
    return json({ ok: true, ...result })
  } catch (error) {
    return mapConvexError(error)
  }
}

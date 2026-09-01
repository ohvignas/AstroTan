export const prerender = false

import type { APIRoute } from "astro"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { FunctionArgs } from "convex/server"
import { getConvexClient } from "../../../lib/convexClient"
import {
  guardWrite,
  honeypotFilled,
  honeypotOk,
  json,
  jsonCode,
  leadSubmitSecret,
  mapConvexError,
  readJson,
  requireVisitorSession,
  stringField,
} from "./_door"

type ListVisitorArgs = FunctionArgs<typeof api.chat.listVisitorMessages>
type StreamArgs = ListVisitorArgs["streamArgs"]

const FIRST_STREAM = { kind: "list" } satisfies StreamArgs

function parseStreamArgs(raw: unknown): StreamArgs | null {
  if (raw === undefined || raw === null || raw === "") return FIRST_STREAM
  if (typeof raw === "object") return raw as StreamArgs
  if (typeof raw !== "string") return null
  try {
    return JSON.parse(raw) as StreamArgs
  } catch {
    return null
  }
}

function parsePagination(raw: unknown, cursorRaw: string | null, numItemsRaw: string | null) {
  if (raw !== undefined && raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>
    const numItems = typeof obj.numItems === "number" && obj.numItems > 0 ? obj.numItems : 32
    const cursor = typeof obj.cursor === "string" ? obj.cursor : null
    return { numItems, cursor }
  }
  const parsed = Number(numItemsRaw ?? "32")
  const numItems = Number.isFinite(parsed) && parsed > 0 ? parsed : 32
  return { numItems, cursor: cursorRaw && cursorRaw.length > 0 ? cursorRaw : null }
}

async function listVisitorMessages(
  secret: string,
  token: string,
  paginationOpts: { numItems: number; cursor: string | null },
  streamArgs: StreamArgs,
): Promise<Response> {
  const session = requireVisitorSession(token)
  if (!session.ok) return session.response

  try {
    const result = await getConvexClient().query(api.chat.listVisitorMessages, {
      secret,
      token,
      paginationOpts,
      streamArgs,
    })
    return json(result)
  } catch (error) {
    return mapConvexError(error)
  }
}

export const GET: APIRoute = async ({ request }) => {
  const secret = leadSubmitSecret()
  if (!secret) return jsonCode("indisponible", 503)

  const url = new URL(request.url)
  const token = url.searchParams.get("token") ?? ""
  const streamArgs = parseStreamArgs(url.searchParams.get("streamArgs"))
  if (streamArgs === null) return jsonCode("empty", 400)

  return listVisitorMessages(
    secret,
    token,
    parsePagination(null, url.searchParams.get("cursor"), url.searchParams.get("numItems")),
    streamArgs,
  )
}

export const POST: APIRoute = async ({ request }) => {
  const gate = guardWrite(request)
  if (gate instanceof Response) return gate

  const payload = await readJson(request)
  if (payload === null) return jsonCode("empty", 400)
  if (honeypotFilled(payload)) return honeypotOk()

  const streamArgs = parseStreamArgs(payload.streamArgs)
  if (streamArgs === null) return jsonCode("empty", 400)

  return listVisitorMessages(
    gate.secret,
    stringField(payload, "token"),
    parsePagination(payload.paginationOpts, null, null),
    streamArgs,
  )
}

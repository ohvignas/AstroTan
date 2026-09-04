// Point public du logo pour les emails : Gmail charge `https://<site>/logo`,
// jamais une URL `storage` Convex. Ce process Node, lui, peut joindre
// Convex et relayer les octets. Sans logo téléversé : 404, pour que
// l'enveloppe d'email n'émette pas de `<img>` cassée.

export const prerender = false

import type { APIRoute } from "astro"
import { api } from "@astrotan/backend/convex/_generated/api"
import { getConvexClient } from "../lib/convexClient"

export const GET: APIRoute = async (context) => {
  context.cache.set(false)
  const settings = await getConvexClient().query(api.settings.get, {})
  const logoId = settings?.logoId
  if (!logoId) return new Response(null, { status: 404 })

  const url = await getConvexClient().query(api.media.publicUrl, { storageId: logoId })
  if (!url) return new Response(null, { status: 404 })

  const upstream = await fetch(url)
  if (!upstream.ok) return new Response(null, { status: 404 })

  const type = upstream.headers.get("content-type") ?? "image/png"
  return new Response(await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      "content-type": type,
      "cache-control": "public, max-age=3600",
    },
  })
}

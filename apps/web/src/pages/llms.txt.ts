import type { APIRoute } from "astro"
import { api } from "@astrotan/backend/convex/_generated/api"
import { SERVED_PATHS } from "@astrotan/backend/convex/lib/servedPaths.generated"
import { getConvexClient } from "../lib/convexClient"
import { buildLlmsTxt } from "../lib/feeds"

// The GEO counterpart of the sitemap: what an answer engine reads to learn
// what this site holds. Anything carrying `geo.noai` is absent from it —
// see `buildLlmsTxt`.
export const prerender = false

export const GET: APIRoute = async (context) => {
  const client = getConvexClient()
  const [settings, pages, posts, homePageSlug] = await Promise.all([
    client.query(api.settings.get, {}),
    client.query(api.pages.listPublishedPages, {}),
    client.query(api.posts.listPublishedPosts, {}),
    client.query(api.settings.homePageSlug, {}),
  ])

  const body = buildLlmsTxt({
    origin: context.url.origin,
    siteName: settings?.siteName ?? "AstroTan",
    pages,
    posts,
    servedPaths: SERVED_PATHS,
    homePageSlug,
  })

  context.cache.set({ maxAge: 3600, swr: 7200, tags: ["pages", "posts"] })

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  })
}

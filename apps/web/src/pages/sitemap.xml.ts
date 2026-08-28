import type { APIRoute } from "astro"
import { api } from "@astrotan/backend/convex/_generated/api"
import { SERVED_PATHS } from "@astrotan/backend/convex/lib/servedPaths.generated"
import { getConvexClient } from "../lib/convexClient"
import { buildSitemap } from "../lib/feeds"

// Generated from Convex on request, never from a build-time snapshot: a
// page published five minutes ago has to appear without a redeploy, which
// is the same promise the rest of the publication loop makes.
export const prerender = false

export const GET: APIRoute = async (context) => {
  const client = getConvexClient()
  const [pages, posts, homePageSlug] = await Promise.all([
    client.query(api.pages.listPublishedPages, {}),
    client.query(api.posts.listPublishedPosts, {}),
    client.query(api.settings.homePageSlug, {}),
  ])

  const xml = buildSitemap({
    origin: context.url.origin,
    pages,
    posts,
    servedPaths: SERVED_PATHS,
    homePageSlug,
  })

  // Cached under both content tags, so publishing either a page or an
  // article refreshes it through the outbox that already exists.
  context.cache.set({ maxAge: 3600, swr: 7200, tags: ["pages", "posts"] })

  return new Response(xml, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  })
}

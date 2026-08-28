import { ConvexError } from "convex/values"
import { SERVED_PATHS, SERVED_PREFIXES } from "./servedPaths.generated"
import { normalizeSlug } from "./slug"

// The four ways a path can already be answered, in one place.
//
// A redirect whose `from` matches any of them would shadow live content:
// the middleware runs before the route, so the visitor never reaches what
// was there. Refusing at write time is the only moment an operator can act
// on it — the alternative is asking Convex on every single request of the
// site to catch a typo.
//
// The fourth source is the one the first attempt at this lot missed. A
// designed page is neither a published row nor a prerendered path: it is an
// `.astro` file with `prerender = false` whose row may not exist yet.

export type PathConflict =
  | { reason: "route"; detail: string }
  | { reason: "page"; detail: string }
  | { reason: "post"; detail: string }
  | { reason: "reserved"; detail: string }

/**
 * `true` when a route file answers on this *exact* path.
 *
 * Exact only, and a dynamic prefix deliberately does not count. `/blog/x`
 * is matched by `blog/[slug].astro`, but what that route serves comes from
 * the database — so the path is live only if a post is live there, which
 * the post lookup below decides. Treating the prefix as "served" would
 * refuse the redirect a renamed article most needs: from its own old URL,
 * which now 404s precisely because the post moved.
 *
 * `/blog` itself is an exact path (`blog/index.astro`) and is still
 * refused.
 */
export function isServedByRoute(path: string): boolean {
  return SERVED_PATHS.includes("/" + normalizeSlug(path))
}

/** `true` when a dynamic route would resolve this path against the database. */
export function isUnderDynamicRoute(path: string): boolean {
  const normalized = "/" + normalizeSlug(path)
  return SERVED_PREFIXES.some((prefix) => normalized.startsWith(prefix + "/"))
}

/**
 * What already answers on this path, or `null`.
 *
 * Checks drafts as well as published rows on purpose: a redirect created
 * while a page is still a draft would shadow it the moment it is published,
 * and nothing would connect the two events.
 */
export async function findPathConflict(
  ctx: { db: { query: (table: "pages" | "posts") => any } },
  path: string,
  reservedSlugs: ReadonlySet<string>
): Promise<PathConflict | null> {
  const slug = normalizeSlug(path)

  if (isServedByRoute(path)) {
    return { reason: "route", detail: `/${slug}` }
  }
  if (reservedSlugs.has(slug.toLowerCase())) {
    return { reason: "reserved", detail: `/${slug}` }
  }

  const page = await ctx.db
    .query("pages")
    .withIndex("by_slug", (q: any) => q.eq("slug", slug))
    .unique()
  if (page !== null) return { reason: "page", detail: page.title }

  // `blog/<slug>` is the only shape an article answers on, and the prefix
  // check above already caught it — but a bare article slug is checked too,
  // so a future route layout change cannot silently open a hole here.
  // Un article vit sous `/blog/<slug>` : c'est ce segment-là qu'il faut
  // comparer, pas le chemin entier. Un chemin sous une route dynamique
  // n'est occupé que si la ligne existe — sinon il rend 404, et le
  // rediriger est exactement ce qu'on veut.
  const postSlug = isUnderDynamicRoute(path)
    ? slug.slice(slug.indexOf("/") + 1)
    : slug
  const post = await ctx.db
    .query("posts")
    .withIndex("by_slug", (q: any) => q.eq("slug", postSlug))
    .unique()
  if (post !== null) return { reason: "post", detail: post.title }

  return null
}

export async function assertPathAvailable(
  ctx: { db: { query: (table: "pages" | "posts") => any } },
  path: string,
  reservedSlugs: ReadonlySet<string>
): Promise<void> {
  const conflict = await findPathConflict(ctx, path, reservedSlugs)
  if (conflict !== null) {
    throw new ConvexError({
      code: "PATH_ALREADY_SERVED",
      reason: conflict.reason,
      detail: conflict.detail,
    })
  }
}

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

/** `true` when a route file already answers on this path. */
export function isServedByRoute(path: string): boolean {
  const normalized = "/" + normalizeSlug(path)
  if (SERVED_PATHS.includes(normalized)) return true
  // A dynamic route owns everything below its prefix: `/blog/[slug]`
  // answers `/blog/anything`, so a redirect from `/blog/x` is shadowed even
  // though no exact path matches.
  return SERVED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix + "/")
  )
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
  const post = await ctx.db
    .query("posts")
    .withIndex("by_slug", (q: any) => q.eq("slug", slug))
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

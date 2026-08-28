import { ConvexError, v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { api, internal } from "./_generated/api"
import type { Id, Doc } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { geoValidator, seoValidator, assertPageTextWithinLimits } from "./content"
import { requireRole, requireOwnDocument } from "./lib/authz"
import { normalizeSlug } from "./lib/slug"
import {
  PREVIEW_TOKEN_TTL_MS,
  signPreviewToken,
  verifyPreviewToken,
} from "./lib/previewToken"
import { insertOutboxRow } from "./revalidate"
import { MUTATION_REGISTRY } from "./_registry"

// Posts are the one place this template still holds content in the
// database, and the exception is deliberate: a blog article *is* content,
// and nobody will ask an agent to write each one. Pages went the other way
// — a page is its `.astro` file — for reasons written in `content.ts`.
//
// Everything around the body is the same machinery pages use: the same SEO
// and GEO validators, the same ownership rules, the same slug helper. Only
// the envelope differs (`excerpt`, `coverId`, `tagIds`).

export const MAX_POST_BODY_LENGTH = 200_000
export const MAX_EXCERPT_LENGTH = 300

/**
 * Page slugs that would be shadowed by a route this site already serves.
 *
 * `/blog` is an Astro route; a CMS page claiming that slug would never be
 * reached, with no error and no trace anywhere. Refusing at write time is
 * the only moment an operator can act on it.
 *
 * Lot 4 adds a third axis to this same question — a redirect whose `from`
 * matches a page slug — and the two guards should end up in one function
 * rather than two that can disagree.
 */
export const RESERVED_PAGE_SLUGS = new Set(["blog"])

async function assertSlugAvailable(
  ctx: MutationCtx,
  slug: string,
  excludeId?: Id<"posts">
): Promise<void> {
  const existing = await ctx.db
    .query("posts")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique()
  if (existing && existing._id !== excludeId) {
    throw new ConvexError({ code: "SLUG_ALREADY_EXISTS" })
  }
}

/**
 * Every tag exists, and none appears twice.
 *
 * A dangling id makes a tag silently vanish from the post that carries it;
 * a duplicate makes the post appear twice in that tag's listing and shows
 * the label twice on the article.
 */
async function assertTagsResolvable(
  ctx: MutationCtx,
  tagIds: Id<"tags">[]
): Promise<void> {
  if (new Set(tagIds).size !== tagIds.length) {
    throw new ConvexError({ code: "DUPLICATE_TAG" })
  }
  for (const tagId of tagIds) {
    if ((await ctx.db.get(tagId)) === null) {
      throw new ConvexError({ code: "UNKNOWN_TAG", tagId })
    }
  }
}

/**
 * The cover file exists in storage.
 *
 * Checked against storage rather than the `media` table on purpose: the
 * library is a sidecar (see `media.ts`), so a file uploaded outside it has
 * no row there and is still a perfectly valid cover.
 */
async function assertCoverResolvable(
  ctx: MutationCtx,
  coverId: Id<"_storage">
): Promise<void> {
  if ((await ctx.storage.getUrl(coverId)) === null) {
    throw new ConvexError({ code: "UNKNOWN_MEDIA", coverId })
  }
}

function assertPostTextWithinLimits(post: {
  title: string
  slug: string
  body?: string
  excerpt?: string
  seo?: Parameters<typeof assertPageTextWithinLimits>[0]["seo"]
  geo?: Parameters<typeof assertPageTextWithinLimits>[0]["geo"]
}): void {
  // `title`, `slug`, `seo` and `geo` are bounded by exactly the same
  // function pages use — one set of limits, not two that drift.
  assertPageTextWithinLimits({
    title: post.title,
    slug: post.slug,
    seo: post.seo,
    geo: post.geo,
  })
  if (post.body !== undefined && post.body.length > MAX_POST_BODY_LENGTH) {
    throw new ConvexError({
      code: "FIELD_TOO_LONG",
      field: "body",
      max: MAX_POST_BODY_LENGTH,
    })
  }
  if (post.excerpt !== undefined && post.excerpt.length > MAX_EXCERPT_LENGTH) {
    throw new ConvexError({
      code: "FIELD_TOO_LONG",
      field: "excerpt",
      max: MAX_EXCERPT_LENGTH,
    })
  }
}

export const create = mutation({
  args: { title: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const title = args.title.trim()
    const slug = normalizeSlug(args.slug)
    if (title.length === 0) throw new ConvexError({ code: "INVALID_TITLE" })
    if (slug.length === 0) throw new ConvexError({ code: "INVALID_SLUG" })
    assertPostTextWithinLimits({ title, slug })
    await assertSlugAvailable(ctx, slug)

    return ctx.db.insert("posts", {
      slug,
      title,
      status: "draft",
      body: "",
      tagIds: [],
      createdBy: authUser._id,
      updatedBy: authUser._id,
    })
  },
})

export const update = mutation({
  args: {
    id: v.id("posts"),
    title: v.optional(v.string()),
    slug: v.optional(v.string()),
    body: v.optional(v.string()),
    excerpt: v.optional(v.string()),
    coverId: v.optional(v.id("_storage")),
    tagIds: v.optional(v.array(v.id("tags"))),
    seo: v.optional(seoValidator),
    geo: v.optional(geoValidator),
  },
  handler: async (ctx, args) => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const post = await ctx.db.get(args.id)
    if (!post) throw new ConvexError({ code: "NOT_FOUND" })
    requireOwnDocument(authUser, post)

    const patch: Partial<Doc<"posts">> & { updatedBy: string } = {
      updatedBy: authUser._id,
    }

    if (args.title !== undefined) {
      const title = args.title.trim()
      if (title.length === 0) throw new ConvexError({ code: "INVALID_TITLE" })
      patch.title = title
    }
    if (args.slug !== undefined) {
      const slug = normalizeSlug(args.slug)
      if (slug.length === 0) throw new ConvexError({ code: "INVALID_SLUG" })
      await assertSlugAvailable(ctx, slug, args.id)
      patch.slug = slug
    }
    if (args.body !== undefined) patch.body = args.body
    if (args.excerpt !== undefined) patch.excerpt = args.excerpt
    if (args.seo !== undefined) patch.seo = args.seo
    if (args.geo !== undefined) patch.geo = args.geo
    if (args.tagIds !== undefined) {
      await assertTagsResolvable(ctx, args.tagIds)
      patch.tagIds = args.tagIds
    }
    if (args.coverId !== undefined) {
      await assertCoverResolvable(ctx, args.coverId)
      patch.coverId = args.coverId
    }

    // Bounds every text field that will land on the row after this patch —
    // the value just validated where the caller sent one, the already-
    // bounded stored value otherwise. Same shape as `pages.update`.
    assertPostTextWithinLimits({
      title: patch.title ?? post.title,
      slug: patch.slug ?? post.slug,
      body: patch.body ?? post.body,
      excerpt: patch.excerpt ?? post.excerpt,
      seo: patch.seo ?? post.seo,
      geo: patch.geo ?? post.geo,
    })

    await ctx.db.patch(args.id, patch)
  },
})

export const remove = mutation({
  args: { id: v.id("posts") },
  handler: async (ctx, args) => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const post = await ctx.db.get(args.id)
    if (!post) throw new ConvexError({ code: "NOT_FOUND" })
    requireOwnDocument(authUser, post)
    await ctx.db.delete(args.id)
  },
})

MUTATION_REGISTRY.push(
  {
    name: "posts.create",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: (t) =>
      t.mutation(api.posts.create, {
        title: "Registry post",
        slug: `registry-${Date.now()}-${Math.random()}`,
      }),
  },
  {
    name: "posts.update",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const id = await t.mutation(api.posts.create, {
        title: "Registry post",
        slug: `registry-${Date.now()}-${Math.random()}`,
      })
      return t.mutation(api.posts.update, { id, body: "# Registry" })
    },
  },
  {
    name: "posts.remove",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const id = await t.mutation(api.posts.create, {
        title: "Registry post",
        slug: `registry-${Date.now()}-${Math.random()}`,
      })
      return t.mutation(api.posts.remove, { id })
    },
  }
)

// ---------------------------------------------------------------------
// La famille publique — et la famille d'aperçu, séparément
// ---------------------------------------------------------------------
//
// Two families, kept apart on purpose and readable apart. `apps/web` has no
// session and no admin key, so a public query that forgot its `status`
// filter is a draft leak with nothing else standing in the way. Factoring
// these two into one parameterised helper would save a dozen lines and cost
// the property a reviewer needs to be able to check at a glance: that no
// function in the first family can return an unpublished row.

const POST_PREVIEW_TOKEN_TYPE = "post"

/** How many published posts `/blog` will list. See the plan's Decision 3. */
export const PUBLISHED_POSTS_LIMIT = 100

export const getPublishedPost = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const post = await ctx.db
      .query("posts")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique()
    if (post === null) return null
    // The filter is here, in the query, never in the caller. `null` covers
    // both "no such slug" and "a draft with that slug" — from the public
    // site's point of view those are the same outcome, deliberately.
    if (post.status !== "published") return null
    return post
  },
})

export const listPublishedPosts = query({
  args: {},
  handler: async (ctx) => {
    // `by_status_published` in that order, descending: "the published ones,
    // newest first" as a single index range scan rather than a full scan
    // filtered in memory.
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .take(PUBLISHED_POSTS_LIMIT + 1)

    if (posts.length > PUBLISHED_POSTS_LIMIT) {
      // Truncating in silence is how a blog quietly stops showing its
      // oldest posts and nobody finds out. Pagination is deliberately not
      // in v1 (plan, Decision 3); this line is the debt saying so out loud.
      console.warn(
        `listPublishedPosts hit its ${PUBLISHED_POSTS_LIMIT}-post ceiling — ` +
          `older posts are not being listed. Time to add pagination.`
      )
    }
    return posts.slice(0, PUBLISHED_POSTS_LIMIT)
  },
})

/**
 * A draft, opened by a valid token — and by nothing else.
 *
 * Keyed on the slug so a preview opens at the post's real URL
 * (`/blog/x?t=…`), like a page's. The token's `type` is `"post"`, and the
 * HMAC covers it: a token minted for a *page* cannot open an article, even
 * one whose slug happens to match.
 */
export const previewPost = query({
  args: { slug: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    const valid = await verifyPreviewToken({
      type: POST_PREVIEW_TOKEN_TYPE,
      id: args.slug,
      token: args.token,
    })
    if (!valid) throw new ConvexError({ code: "INVALID_PREVIEW_TOKEN" })

    return ctx.db
      .query("posts")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique()
  },
})

export const mintPostPreviewToken = mutation({
  args: { id: v.id("posts") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const post = await ctx.db.get(args.id)
    if (!post) throw new ConvexError({ code: "NOT_FOUND" })

    const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS
    // Reads the slug from the row rather than trusting a caller-supplied
    // one: that is what stops a token being minted for a post the caller
    // names but has no handle on.
    const token = await signPreviewToken({
      type: POST_PREVIEW_TOKEN_TYPE,
      id: post.slug,
      expiresAt,
    })
    return { token, expiresAt, slug: post.slug }
  },
})

MUTATION_REGISTRY.push({
  name: "posts.mintPostPreviewToken",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: async (t) => {
    const id = await t.mutation(api.posts.create, {
      title: "Registry post",
      slug: `registry-${Date.now()}-${Math.random()}`,
    })
    return t.mutation(api.posts.mintPostPreviewToken, { id })
  },
})

// ---------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------

/**
 * Flip a post live, and record the invalidation in the same transaction.
 *
 * `insertOutboxRow` is a plain `ctx.db.insert`, not a nested mutation call:
 * that is what makes the row impossible to lose. Either both writes land or
 * neither does, so there is no window where `status` says published and
 * nothing was ever queued to invalidate the cache.
 *
 * Republishing an already-published post still writes a fresh row: every
 * publish is a signal that what is live may be stale, whether or not
 * `status` itself changed.
 */
export const publishPost = mutation({
  args: { id: v.id("posts") },
  handler: async (ctx, args) => {
    // Publishing is owner/admin, never the editor who wrote the post —
    // enforced here, not by the dashboard hiding a button.
    await requireRole(ctx, ["owner", "admin"])
    const post = await ctx.db.get(args.id)
    if (!post) throw new ConvexError({ code: "NOT_FOUND" })

    await ctx.db.patch(args.id, { status: "published", publishedAt: Date.now() })
    await insertOutboxRow(ctx, { kind: "post", postId: args.id }, [
      "posts",
      `post:${post.slug}`,
    ])
    // The fast path: don't wait for the next cron sweep when nothing is
    // wrong. The cron is the recovery path for when this call is lost, not
    // the primary one.
    await ctx.scheduler.runAfter(0, internal.revalidate.drain, {})
  },
})

/**
 * Take a post offline, and invalidate just as hard.
 *
 * Unpublishing without invalidating leaves the article served from cache
 * for up to `maxAge` after it was withdrawn — the failure mode that matters
 * most here, since withdrawing is usually urgent.
 */
export const unpublishPost = mutation({
  args: { id: v.id("posts") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])
    const post = await ctx.db.get(args.id)
    if (!post) throw new ConvexError({ code: "NOT_FOUND" })

    await ctx.db.patch(args.id, { status: "draft" })
    await insertOutboxRow(ctx, { kind: "post", postId: args.id }, [
      "posts",
      `post:${post.slug}`,
    ])
    await ctx.scheduler.runAfter(0, internal.revalidate.drain, {})
  },
})

export const publicationStatus = query({
  args: { id: v.id("posts") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const post = await ctx.db.get(args.id)
    if (!post) return null
    if (post.status !== "published") return { state: "draft" as const }

    // A single index range scan on this post's own rows, newest first —
    // never a scan of the whole outbox, which is never pruned and only
    // grows.
    const latest = await ctx.db
      .query("revalidationOutbox")
      .withIndex("by_post_created_at", (q) => q.eq("postId", args.id))
      .order("desc")
      .first()

    // No row at all for an already-published post is real but narrow (a
    // fixture seeded straight to `published`): treated as settled rather
    // than stuck propagating forever with nothing to resolve it.
    if (!latest || latest.status === "done") {
      return { state: "published" as const, publishedAt: post.publishedAt }
    }
    if (latest.status === "failed") {
      return {
        state: "failed" as const,
        lastError: latest.lastError,
        attempts: latest.attempts,
      }
    }
    return { state: "propagating" as const, attempts: latest.attempts }
  },
})

MUTATION_REGISTRY.push(
  {
    name: "posts.publishPost",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const id = await t.mutation(api.posts.create, {
        title: "Registry post",
        slug: `registry-${Date.now()}-${Math.random()}`,
      })
      return t.mutation(api.posts.publishPost, { id })
    },
  },
  {
    name: "posts.unpublishPost",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const id = await t.mutation(api.posts.create, {
        title: "Registry post",
        slug: `registry-${Date.now()}-${Math.random()}`,
      })
      return t.mutation(api.posts.unpublishPost, { id })
    },
  }
)

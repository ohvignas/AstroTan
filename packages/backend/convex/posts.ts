import { ConvexError, v } from "convex/values"
import { mutation } from "./_generated/server"
import { api } from "./_generated/api"
import type { Id, Doc } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { geoValidator, seoValidator, assertPageTextWithinLimits } from "./content"
import { requireRole, requireOwnDocument } from "./lib/authz"
import { normalizeSlug } from "./lib/slug"
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

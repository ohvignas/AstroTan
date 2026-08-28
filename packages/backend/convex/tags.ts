import { ConvexError, v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { api } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { requireRole } from "./lib/authz"
import { slugify } from "./lib/slug"
import { MUTATION_REGISTRY } from "./_registry"

// Tags carry two strings for one idea: the `name` a human typed, kept
// exactly as typed, and the `slug` derived from it, which is what a URL
// and uniqueness are decided on.
//
// Uniqueness is on the slug, never the name. "Astro" and "astro" are the
// same tag — allowing both would produce two URLs listing the same posts,
// and nobody would notice until the second one had followers.

export const MAX_TAG_NAME_LENGTH = 50

/**
 * Bound and derive, or refuse.
 *
 * A name can be non-empty and still slugify to nothing ("!!!", an emoji).
 * Storing that would give the tag an empty slug, which collides with every
 * other empty slug — so it is refused as an invalid name rather than
 * silently accepted with a broken URL.
 */
function nameAndSlug(raw: string): { name: string; slug: string } {
  if (raw.length > MAX_TAG_NAME_LENGTH) {
    throw new ConvexError({
      code: "FIELD_TOO_LONG",
      field: "name",
      max: MAX_TAG_NAME_LENGTH,
    })
  }
  const name = raw.trim()
  const slug = slugify(name)
  if (name.length === 0 || slug.length === 0) {
    throw new ConvexError({ code: "INVALID_NAME" })
  }
  return { name, slug }
}

/**
 * Refuse a slug another tag already holds.
 *
 * `exclude` is what makes renaming a tag to a different spelling of its own
 * name work ("Astro" → "ASTRO"): without it, a tag always collides with
 * itself and can only be renamed by deleting it first.
 */
async function assertSlugAvailable(
  ctx: { db: { query: (t: "tags") => any } },
  slug: string,
  exclude?: Id<"tags">
) {
  const existing = await ctx.db
    .query("tags")
    .withIndex("by_slug", (q: any) => q.eq("slug", slug))
    .unique()
  if (existing !== null && existing._id !== exclude) {
    throw new ConvexError({ code: "SLUG_TAKEN", slug })
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const rows = await ctx.db.query("tags").collect()
    // Alphabetical by display name, not by slug and not by insertion: this
    // list is a picker in a form, and a human looks things up by the name
    // they read.
    return rows.sort((a, b) => a.name.localeCompare(b.name, "fr"))
  },
})

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const { name, slug } = nameAndSlug(args.name)
    await assertSlugAvailable(ctx, slug)
    return ctx.db.insert("tags", { name, slug })
  },
})

export const rename = mutation({
  args: { id: v.id("tags"), name: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const row = await ctx.db.get(args.id)
    if (!row) throw new ConvexError({ code: "NOT_FOUND" })

    const { name, slug } = nameAndSlug(args.name)
    await assertSlugAvailable(ctx, slug, args.id)
    await ctx.db.patch(args.id, { name, slug })
  },
})

export const remove = mutation({
  args: { id: v.id("tags") },
  handler: async (ctx, args) => {
    // Deleting a tag is not an editor's call: it changes what every post
    // carrying it is filed under, across the whole site.
    await requireRole(ctx, ["owner", "admin"])
    const row = await ctx.db.get(args.id)
    if (!row) throw new ConvexError({ code: "NOT_FOUND" })

    // The `TAG_IN_USE` guard lands with `posts` (Task 3) — there is no
    // table carrying `tagIds` yet, so there is nothing to check against.
    // Written here as a marker rather than left to be remembered: a tag
    // deleted out from under a post leaves a dangling id in an array,
    // which reads as a tag that silently vanished from that post.
    await ctx.db.delete(args.id)
  },
})

MUTATION_REGISTRY.push(
  {
    name: "tags.create",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: (t) =>
      t.mutation(api.tags.create, { name: `Registry ${Date.now()}${Math.random()}` }),
  },
  {
    name: "tags.rename",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const id = await t.mutation(api.tags.create, {
        name: `Registry ${Date.now()}${Math.random()}`,
      })
      return t.mutation(api.tags.rename, {
        id,
        name: `Renamed ${Date.now()}${Math.random()}`,
      })
    },
  },
  {
    name: "tags.remove",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const id = await t.mutation(api.tags.create, {
        name: `Registry ${Date.now()}${Math.random()}`,
      })
      return t.mutation(api.tags.remove, { id })
    },
  }
)

import { ConvexError, v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server"
import {
  geoValidator,
  seoValidator,
  assertPageTextWithinLimits,
  assertTargetKeyword,
} from "./content"
import { overlayForEditor } from "./lib/postWorkingCopy"
import {
  writePostCreate,
  writePostPublish,
  writePostRemove,
  writePostUnpublish,
  writePostUpdate,
} from "./lib/apiPostWrite"
import { slugify } from "./lib/slug"
import { MAX_TAG_NAME_LENGTH } from "./content"

export const lookupToken = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("apiTokens")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique(),
})

export const listPosts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const posts = await ctx.db.query("posts").order("desc").collect()
    return posts.map((post) => overlayForEditor(post))
  },
})

export const getPost = internalQuery({
  args: { id: v.id("posts") },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.id)
    return post === null ? null : overlayForEditor(post)
  },
})

export const createPost = internalMutation({
  args: { title: v.string(), slug: v.string(), acteurId: v.string() },
  handler: async (ctx, args) => writePostCreate(ctx, args.acteurId, args),
})

export const updatePost = internalMutation({
  args: {
    id: v.id("posts"),
    acteurId: v.string(),
    title: v.optional(v.string()),
    slug: v.optional(v.string()),
    body: v.optional(v.string()),
    excerpt: v.optional(v.string()),
    coverId: v.optional(v.union(v.id("_storage"), v.null())),
    tagIds: v.optional(v.array(v.id("tags"))),
    seo: v.optional(seoValidator),
    geo: v.optional(geoValidator),
    targetKeyword: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { acteurId, ...patch } = args
    await writePostUpdate(ctx, acteurId, patch)
  },
})

export const removePost = internalMutation({
  args: { id: v.id("posts"), acteurId: v.string() },
  handler: async (ctx, args) => writePostRemove(ctx, args.acteurId, args.id),
})

export const publishPost = internalMutation({
  args: { id: v.id("posts"), acteurId: v.string() },
  handler: async (ctx, args) => writePostPublish(ctx, args.acteurId, args.id),
})

export const unpublishPost = internalMutation({
  args: { id: v.id("posts"), acteurId: v.string() },
  handler: async (ctx, args) => writePostUnpublish(ctx, args.acteurId, args.id),
})

export const listLeads = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("leads").order("desc").collect(),
})

export const getLead = internalQuery({
  args: { id: v.id("leads") },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.id)
    if (lead === null) throw new ConvexError({ code: "NOT_FOUND" })
    return lead
  },
})

export const listPages = internalQuery({
  args: {},
  handler: async (ctx) => {
    const pages = await ctx.db.query("pages").order("desc").collect()
    return pages.map(({ _id, slug, title, status, seo, geo, targetKeyword }) => ({
      _id,
      slug,
      title,
      status,
      seo,
      geo,
      targetKeyword,
    }))
  },
})

export const getPage = internalQuery({
  args: { id: v.id("pages") },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.id)
    if (page === null) throw new ConvexError({ code: "NOT_FOUND" })
    const { _id, slug, title, status, seo, geo, targetKeyword } = page
    return { _id, slug, title, status, seo, geo, targetKeyword }
  },
})

export const updatePage = internalMutation({
  args: {
    id: v.id("pages"),
    acteurId: v.string(),
    title: v.optional(v.string()),
    seo: v.optional(seoValidator),
    geo: v.optional(geoValidator),
    targetKeyword: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.id)
    if (!page) throw new ConvexError({ code: "NOT_FOUND" })
    const patch: {
      title?: string
      seo?: typeof args.seo
      geo?: typeof args.geo
      targetKeyword?: string
      updatedBy: string
    } = { updatedBy: args.acteurId }
    let clearTargetKeyword = false
    if (args.title !== undefined) {
      const title = args.title.trim()
      if (title.length === 0) throw new ConvexError({ code: "INVALID_TITLE" })
      patch.title = title
    }
    if (args.seo !== undefined) patch.seo = args.seo
    if (args.geo !== undefined) patch.geo = args.geo
    if (args.targetKeyword !== undefined) {
      const next = assertTargetKeyword(args.targetKeyword)
      if (next === undefined) clearTargetKeyword = true
      else patch.targetKeyword = next
    }
    assertPageTextWithinLimits({
      title: patch.title ?? page.title,
      slug: page.slug,
      seo: patch.seo ?? page.seo,
      geo: patch.geo ?? page.geo,
    })
    if (clearTargetKeyword) {
      const { _id, _creationTime, targetKeyword: _d, ...kept } = page
      await ctx.db.replace(args.id, { ...kept, ...patch })
    } else {
      await ctx.db.patch(args.id, patch)
    }
  },
})

export const listTags = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("tags").collect()
    return rows.sort((a, b) => a.name.localeCompare(b.name, "fr"))
  },
})

export const createTag = internalMutation({
  args: { name: v.string(), acteurId: v.string() },
  handler: async (ctx, args) => {
    if (args.name.length > MAX_TAG_NAME_LENGTH) {
      throw new ConvexError({
        code: "FIELD_TOO_LONG",
        field: "name",
        max: MAX_TAG_NAME_LENGTH,
      })
    }
    const name = args.name.trim()
    const slug = slugify(name)
    if (name.length === 0 || slug.length === 0) {
      throw new ConvexError({ code: "INVALID_NAME" })
    }
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique()
    if (existing !== null) throw new ConvexError({ code: "SLUG_TAKEN", slug })
    return ctx.db.insert("tags", { name, slug })
  },
})

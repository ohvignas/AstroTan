import { ConvexError } from "convex/values"
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import {
  assertPageTextWithinLimits,
  assertTargetKeyword,
  MAX_EXCERPT_LENGTH,
  MAX_POST_BODY_LENGTH,
} from "../content"
import { normalizeSlug } from "./slug"
import {
  applyWorkingPatch,
  applyWorkingToLive,
  snapshotLive,
} from "./postWorkingCopy"
import { insertOutboxRow } from "../revalidate"
import { mintRenameRedirect } from "../redirects"
import { journaliser } from "./auditEvent"

function assertPostText(post: {
  title: string
  slug: string
  body?: string
  excerpt?: string
  seo?: Parameters<typeof assertPageTextWithinLimits>[0]["seo"]
  geo?: Parameters<typeof assertPageTextWithinLimits>[0]["geo"]
}) {
  assertPageTextWithinLimits(post)
  if (post.body !== undefined && post.body.length > MAX_POST_BODY_LENGTH) {
    throw new ConvexError({ code: "FIELD_TOO_LONG", field: "body", max: MAX_POST_BODY_LENGTH })
  }
  if (post.excerpt !== undefined && post.excerpt.length > MAX_EXCERPT_LENGTH) {
    throw new ConvexError({ code: "FIELD_TOO_LONG", field: "excerpt", max: MAX_EXCERPT_LENGTH })
  }
}

async function assertSlugFree(ctx: MutationCtx, slug: string, exclude?: Id<"posts">) {
  const existing = await ctx.db.query("posts").withIndex("by_slug", (q) => q.eq("slug", slug)).unique()
  if (existing && existing._id !== exclude) throw new ConvexError({ code: "SLUG_ALREADY_EXISTS" })
}

export async function writePostCreate(
  ctx: MutationCtx,
  acteurId: string,
  args: { title: string; slug: string },
) {
  const title = args.title.trim()
  const slug = normalizeSlug(args.slug)
  if (title.length === 0) throw new ConvexError({ code: "INVALID_TITLE" })
  if (slug.length === 0) throw new ConvexError({ code: "INVALID_SLUG" })
  assertPostText({ title, slug })
  await assertSlugFree(ctx, slug)
  return ctx.db.insert("posts", {
    slug,
    title,
    status: "draft",
    body: "",
    tagIds: [],
    createdBy: acteurId,
    updatedBy: acteurId,
  })
}

export async function writePostUpdate(
  ctx: MutationCtx,
  acteurId: string,
  args: {
    id: Id<"posts">
    title?: string
    slug?: string
    body?: string
    excerpt?: string
    coverId?: Id<"_storage"> | null
    tagIds?: Id<"tags">[]
    seo?: Doc<"posts">["seo"]
    geo?: Doc<"posts">["geo"]
    targetKeyword?: string
  },
) {
  const post = await ctx.db.get(args.id)
  if (!post) throw new ConvexError({ code: "NOT_FOUND" })

  const patch: Partial<Doc<"posts">> & { updatedBy: string } = { updatedBy: acteurId }
  if (args.title !== undefined) {
    const title = args.title.trim()
    if (title.length === 0) throw new ConvexError({ code: "INVALID_TITLE" })
    patch.title = title
  }
  if (args.slug !== undefined) {
    const slug = normalizeSlug(args.slug)
    if (slug.length === 0) throw new ConvexError({ code: "INVALID_SLUG" })
    await assertSlugFree(ctx, slug, args.id)
    patch.slug = slug
  }
  if (args.body !== undefined) patch.body = args.body
  if (args.excerpt !== undefined) patch.excerpt = args.excerpt
  if (args.seo !== undefined) patch.seo = args.seo
  if (args.geo !== undefined) patch.geo = args.geo
  let clearTargetKeyword = false
  if (args.targetKeyword !== undefined) {
    const keyword = assertTargetKeyword(args.targetKeyword)
    if (keyword === undefined) clearTargetKeyword = true
    else patch.targetKeyword = keyword
  }
  if (args.tagIds !== undefined) {
    if (new Set(args.tagIds).size !== args.tagIds.length) {
      throw new ConvexError({ code: "DUPLICATE_TAG" })
    }
    for (const tagId of args.tagIds) {
      if ((await ctx.db.get(tagId)) === null) throw new ConvexError({ code: "UNKNOWN_TAG", tagId })
    }
    patch.tagIds = args.tagIds
  }
  if (args.coverId !== undefined && args.coverId !== null) {
    if ((await ctx.storage.getUrl(args.coverId)) === null) {
      throw new ConvexError({ code: "UNKNOWN_MEDIA", coverId: args.coverId })
    }
  }

  if (post.status === "published") {
    const working = applyWorkingPatch(post.workingCopy ?? snapshotLive(post), {
      title: patch.title,
      slug: patch.slug,
      body: patch.body,
      excerpt: patch.excerpt,
      seo: patch.seo,
      geo: patch.geo,
      tagIds: patch.tagIds,
      coverId: args.coverId,
      targetKeyword: clearTargetKeyword
        ? null
        : args.targetKeyword !== undefined
          ? patch.targetKeyword
          : undefined,
    })
    assertPostText(working)
    await ctx.db.patch(args.id, { workingCopy: working, updatedBy: acteurId })
    return
  }

  assertPostText({
    title: patch.title ?? post.title,
    slug: patch.slug ?? post.slug,
    body: patch.body ?? post.body,
    excerpt: patch.excerpt ?? post.excerpt,
    seo: patch.seo ?? post.seo,
    geo: patch.geo ?? post.geo,
  })
  const { _id, _creationTime, coverId: oldCover, workingCopy: _wc, ...kept } = post
  const next = { ...kept, ...patch }
  if (args.coverId === null) delete (next as { coverId?: unknown }).coverId
  else if (args.coverId !== undefined) next.coverId = args.coverId
  else if (oldCover !== undefined) next.coverId = oldCover
  if (clearTargetKeyword) delete (next as { targetKeyword?: unknown }).targetKeyword
  await ctx.db.replace(args.id, next)
}

export async function writePostPublish(ctx: MutationCtx, acteurId: string, id: Id<"posts">) {
  const post = await ctx.db.get(id)
  if (!post) throw new ConvexError({ code: "NOT_FOUND" })
  const oldSlug = post.slug
  let nextSlug = post.slug
  if (post.workingCopy !== undefined) {
    nextSlug = post.workingCopy.slug
    if (nextSlug !== oldSlug) await assertSlugFree(ctx, nextSlug, id)
    const { _id, _creationTime, ...kept } = applyWorkingToLive(post)
    await ctx.db.replace(id, {
      ...kept,
      status: "published",
      publishedAt: Date.now(),
      updatedBy: acteurId,
    })
    if (nextSlug !== oldSlug && post.publishedAt !== undefined) {
      await mintRenameRedirect(ctx, `blog/${oldSlug}`, `blog/${nextSlug}`, acteurId)
    }
  } else {
    await ctx.db.patch(id, { status: "published", publishedAt: Date.now() })
  }
  const tags = ["posts", `post:${oldSlug}`]
  if (nextSlug !== oldSlug) tags.push(`post:${nextSlug}`)
  await insertOutboxRow(ctx, { kind: "post", postId: id }, tags)
  await ctx.scheduler.runAfter(0, internal.revalidate.drain, {})
  await journaliser(ctx, {
    acteur: { _id: acteurId, email: "" },
    action: "post.publish",
    cible: nextSlug,
  })
}

export async function writePostUnpublish(ctx: MutationCtx, acteurId: string, id: Id<"posts">) {
  const post = await ctx.db.get(id)
  if (!post) throw new ConvexError({ code: "NOT_FOUND" })
  if (post.status !== "published") return
  if (post.workingCopy !== undefined) {
    const { _id, _creationTime, ...kept } = applyWorkingToLive(post)
    await ctx.db.replace(id, { ...kept, status: "draft", updatedBy: acteurId })
  } else {
    await ctx.db.patch(id, { status: "draft" })
  }
  await insertOutboxRow(ctx, { kind: "post", postId: id }, ["posts", `post:${post.slug}`])
  await ctx.scheduler.runAfter(0, internal.revalidate.drain, {})
  await journaliser(ctx, {
    acteur: { _id: acteurId, email: "" },
    action: "post.unpublish",
    cible: post.slug,
  })
}

export async function writePostRemove(ctx: MutationCtx, acteurId: string, id: Id<"posts">) {
  const post = await ctx.db.get(id)
  if (!post) throw new ConvexError({ code: "NOT_FOUND" })
  await ctx.db.delete(id)
  if (post.status === "published") {
    await insertOutboxRow(ctx, { kind: "post", postId: id }, ["posts", `post:${post.slug}`])
    await ctx.scheduler.runAfter(0, internal.revalidate.drain, {})
  }
  await journaliser(ctx, {
    acteur: { _id: acteurId, email: "" },
    action: "post.remove",
    cible: post.slug,
  })
}

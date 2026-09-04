import { ConvexError, v } from "convex/values"
import { action } from "./_generated/server"
import { api } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { requireOwnDocument, requirePublishedPageWritable, requireRole } from "./lib/authz"
import { authComponent } from "./auth"
import { coverPrompt, pageOgPrompt } from "./lib/coverPrompt"
import { classifyPageKind } from "./lib/seoGeoPageKind"
import { contexteSite } from "./lib/aiSiteContext"
import { generateAndRegisterCover } from "./lib/storeGeneratedMedia"
import { MUTATION_REGISTRY } from "./_registry"
import {
  appendExtraInstructions,
  normalizeExtraInstructions,
} from "./lib/extraInstructions"

export const generatePostCover = action({
  args: {
    postId: v.id("posts"),
    extraInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ storageId: Id<"_storage"> }> => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const post = await ctx.runQuery(api.posts.get, { id: args.postId })
    if (post === null) throw new ConvexError({ code: "NOT_FOUND" })
    requireOwnDocument(authUser, post)
    requirePublishedPageWritable(authUser, post)
    const extra = normalizeExtraInstructions(args.extraInstructions)

    const site = await contexteSite(ctx)
    const storageId = await generateAndRegisterCover(ctx, {
      prompt: appendExtraInstructions(
        coverPrompt({
          title: post.title,
          excerpt: post.excerpt,
          targetKeyword: post.targetKeyword,
          siteName: site.siteName,
        }),
        extra,
      ),
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      targetKeyword: post.targetKeyword,
      prefix: "une",
      fallbackAlt: "Couverture",
    })
    await ctx.runMutation(api.posts.update, { id: post._id, coverId: storageId })
    return { storageId }
  },
})

export const generatePageOg = action({
  args: {
    pageId: v.id("pages"),
    extraInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ storageId: Id<"_storage"> }> => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const page = await ctx.runQuery(api.pages.get, { id: args.pageId })
    if (page === null) throw new ConvexError({ code: "NOT_FOUND" })
    requireOwnDocument(authUser, page)
    requirePublishedPageWritable(authUser, page)
    const extra = normalizeExtraInstructions(args.extraInstructions)

    const site = await contexteSite(ctx)
    const storageId = await generateAndRegisterCover(ctx, {
      prompt: appendExtraInstructions(
        pageOgPrompt({
          title: page.title,
          slug: page.slug,
          pageKind: classifyPageKind(
            { kind: "page", slug: page.slug, title: page.title },
            site.homePageSlug,
          ),
          targetKeyword: page.targetKeyword,
          siteName: site.siteName,
        }),
        extra,
      ),
      slug: page.slug,
      title: page.title,
      targetKeyword: page.targetKeyword,
      prefix: "og",
      fallbackAlt: "Partage",
    })
    await ctx.runMutation(api.pages.update, {
      id: page._id,
      seo: { ...page.seo, ogImageId: storageId },
    })
    return { storageId }
  },
})

MUTATION_REGISTRY.push({
  name: "aiImage.generatePostCover",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: async (t) => {
    process.env.OPENROUTER_API_KEY = "sk-or-registry-fixture"
    const authUser = await t.run((ctx: never) => authComponent.safeGetAuthUser(ctx))
    const ownerId = (authUser as { _id: string })._id
    const id = await t.run((ctx: { db: { insert: Function } }) =>
      ctx.db.insert("posts", {
        slug: `registry-cover-${Date.now()}-${Math.random()}`,
        title: "Registry Cover",
        excerpt: "Chapô.",
        body: "<p>Corps.</p>",
        status: "draft",
        tagIds: [],
        createdBy: ownerId,
        updatedBy: ownerId,
      }),
    )
    return t.action(api.aiImage.generatePostCover, { postId: id })
  },
})

MUTATION_REGISTRY.push({
  name: "aiImage.generatePageOg",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: async (t) => {
    process.env.OPENROUTER_API_KEY = "sk-or-registry-fixture"
    const authUser = await t.run((ctx: never) => authComponent.safeGetAuthUser(ctx))
    const ownerId = (authUser as { _id: string })._id
    const id = await t.run((ctx: { db: { insert: Function } }) =>
      ctx.db.insert("pages", {
        slug: `registry-og-${Date.now()}-${Math.random()}`,
        title: "Registry OG",
        status: "draft",
        createdBy: ownerId,
        updatedBy: ownerId,
      }),
    )
    return t.action(api.aiImage.generatePageOg, { pageId: id })
  },
})

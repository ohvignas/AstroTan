import { ConvexError, v } from "convex/values"
import { action, internalMutation } from "./_generated/server"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { requireOwnDocument, requirePublishedPageWritable, requireRole } from "./lib/authz"
import { authComponent } from "./auth"
import { lireSecret } from "./secrets"
import { publicUrl } from "./lib/publicPath"
import { completerJson } from "./lib/openrouter"
import { resolveOpenRouterModel } from "./lib/openRouterModels"
import { contexteSite, siteBits } from "./lib/aiSiteContext"
import { systemPrompt, userPrompt } from "./lib/seoGeoPrompt"
import {
  draftFromModel,
  isEmptyDraft,
  type GenerationSource,
  type SeoGeoDraft,
} from "./lib/seoGeoDraft"
import { MUTATION_REGISTRY } from "./_registry"
import {
  appendExtraInstructions,
  normalizeExtraInstructions,
} from "./lib/extraInstructions"
import { demoSandboxActif, estCompteDemo, modeleSandbox } from "./lib/demoSandbox"
import { assertDemoAiBudget as consumeDemoAiBudget } from "./lib/demoAiQuota"

export const assertDemoAiBudget = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    await consumeDemoAiBudget(ctx, args.userId)
  },
})

export const generateSeoGeo = action({
  args: {
    pageId: v.optional(v.id("pages")),
    postId: v.optional(v.id("posts")),
    extraInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SeoGeoDraft> => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    if ((args.pageId === undefined) === (args.postId === undefined)) {
      throw new ConvexError({ code: "INVALID_TARGET" })
    }
    const env = process.env
    if (estCompteDemo(authUser, env)) {
      await ctx.runMutation(internal.ai.assertDemoAiBudget, { userId: authUser._id })
    }

    const site = await contexteSite(ctx)
    let source: GenerationSource
    let existingNoai = false

    if (args.pageId !== undefined) {
      const page = await ctx.runQuery(api.pages.get, { id: args.pageId })
      if (page === null) throw new ConvexError({ code: "NOT_FOUND" })
      requireOwnDocument(authUser, page)
      requirePublishedPageWritable(authUser, page)
      existingNoai = page.geo?.noai === true
      source = {
        kind: "page",
        title: page.title,
        slug: page.slug,
        publicUrl: site.webOrigin
          ? publicUrl(site.webOrigin, page.slug, site.homePageSlug)
          : undefined,
        targetKeyword: page.targetKeyword,
        seo: page.seo
          ? { title: page.seo.title, description: page.seo.description }
          : undefined,
        geo: page.geo
          ? {
              summary: page.geo.summary ?? "",
              faq: page.geo.faq ?? [],
              entities: page.geo.entities ?? [],
              noai: page.geo.noai === true,
            }
          : undefined,
        ...siteBits(site),
      }
    } else {
      const post = await ctx.runQuery(api.posts.get, { id: args.postId as Id<"posts"> })
      if (post === null) throw new ConvexError({ code: "NOT_FOUND" })
      requireOwnDocument(authUser, post)
      requirePublishedPageWritable(authUser, post)
      existingNoai = post.geo?.noai === true
      source = {
        kind: "post",
        title: post.title,
        slug: post.slug,
        publicUrl: site.webOrigin
          ? `${site.webOrigin.replace(/\/+$/, "")}/blog/${post.slug}`
          : undefined,
        excerpt: post.excerpt,
        body: post.body,
        targetKeyword: post.targetKeyword,
        seo: post.seo
          ? { title: post.seo.title, description: post.seo.description }
          : undefined,
        geo: post.geo
          ? {
              summary: post.geo.summary ?? "",
              faq: post.geo.faq ?? [],
              entities: post.geo.entities ?? [],
              noai: post.geo.noai === true,
            }
          : undefined,
        ...siteBits(site),
      }
    }

    const extra = normalizeExtraInstructions(args.extraInstructions)
    const apiKey = await lireSecret(ctx, "OPENROUTER_API_KEY")
    if (apiKey === null) {
      throw new ConvexError({ code: "OPENROUTER_NOT_CONFIGURED" })
    }

    const privee = await ctx.runQuery(api.settings.getPrivate, {})
    let model: string
    if (demoSandboxActif(env)) {
      const slug = modeleSandbox({}, env)
      if (!slug) throw new ConvexError({ code: "DEMO_NOT_CONFIGURED" })
      model = slug
    } else {
      model = resolveOpenRouterModel(privee?.openRouterModel)
    }
    const raw = await completerJson({
      apiKey,
      model,
      system: systemPrompt(source),
      user: appendExtraInstructions(userPrompt(source), extra),
      referer: site.webOrigin,
    })
    const draft = draftFromModel(raw, existingNoai)
    if (isEmptyDraft(draft)) {
      throw new ConvexError({ code: "OPENROUTER_BAD_RESPONSE", reason: "empty" })
    }
    return draft
  },
})

MUTATION_REGISTRY.push({
  name: "ai.generateSeoGeo",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: async (t) => {
    process.env.OPENROUTER_API_KEY = "sk-or-registry-fixture"
    const authUser = await t.run((ctx) => authComponent.safeGetAuthUser(ctx as never))
    const ownerId = (authUser as { _id: string })._id
    const id = await t.run((ctx: { db: { insert: Function } }) =>
      ctx.db.insert("pages", {
        slug: `registry-ai-${Date.now()}-${Math.random()}`,
        title: "Registry Check",
        status: "draft",
        createdBy: ownerId,
        updatedBy: ownerId,
      }),
    )
    return t.action(api.ai.generateSeoGeo, { pageId: id })
  },
})

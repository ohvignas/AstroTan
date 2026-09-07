import { v } from "convex/values"
import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { internal } from "./_generated/api"
import { lireSecret } from "./secrets"
import { completerJson } from "./lib/openrouter"
import { contexteSite, siteBits } from "./lib/aiSiteContext"
import { systemPrompt, userPrompt } from "./lib/seoGeoPrompt"
import { draftFromModel, isEmptyDraft, type GenerationSource } from "./lib/seoGeoDraft"
import { demoSandboxActif, modeleSandbox } from "./lib/demoSandbox"
import { geoValidator, seoValidator } from "./content"

const PRODUCT_SLUGS = [
  "astrotan-site-vitrine-cms",
  "site-vitrine-sans-wordpress",
] as const

const EXTRA =
  "Reste factuel sur AstroTan (Astro, TanStack Start, Convex, Traefik, VPS). N'invente aucune feature absente. Français, sans clickbait."

export const articleParSlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("posts")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique(),
})

export const appliquerSeo = internalMutation({
  args: {
    slug: v.string(),
    seo: seoValidator,
    geo: geoValidator,
    excerpt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db
      .query("posts")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique()
    if (post === null) return { ok: false as const }
    await ctx.db.patch(post._id, {
      seo: { ...post.seo, ...args.seo },
      geo: { ...post.geo, ...args.geo },
      ...(args.excerpt && args.excerpt.length > 0 ? { excerpt: args.excerpt } : {}),
    })
    return { ok: true as const }
  },
})

/**
 * Même pipeline que `ai.generateSeoGeo` (prompts, OpenRouter, draftFromModel),
 * sans session : un `npx convex run` n'en a pas. Réservé au bac à sable.
 */
export const genererSeo = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!demoSandboxActif(process.env)) return { skipped: true as const, results: [] }
    const apiKey = await lireSecret(ctx, "OPENROUTER_API_KEY")
    if (apiKey === null) return { skipped: true as const, reason: "no-key", results: [] }
    const model = modeleSandbox({}, process.env)
    if (!model) return { skipped: true as const, reason: "no-model", results: [] }

    const site = await contexteSite(ctx)
    const results: { slug: string; ok: boolean; reason?: string }[] = []

    for (const slug of PRODUCT_SLUGS) {
      const post = await ctx.runQuery(internal.seedProductAi.articleParSlug, { slug })
      if (post === null) {
        results.push({ slug, ok: false, reason: "missing" })
        continue
      }
      const source: GenerationSource = {
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
      const raw = await completerJson({
        apiKey,
        model,
        system: systemPrompt(source),
        user: `${userPrompt(source)}\n\nInstruction complémentaire :\n${EXTRA}`,
        referer: site.webOrigin,
      })
      const draft = draftFromModel(raw, post.geo?.noai === true)
      if (isEmptyDraft(draft)) {
        results.push({ slug, ok: false, reason: "empty" })
        continue
      }
      await ctx.runMutation(internal.seedProductAi.appliquerSeo, {
        slug,
        seo: draft.seo,
        geo: draft.geo,
        excerpt: draft.excerpt,
      })
      results.push({ slug, ok: true })
    }

    return { skipped: false as const, results }
  },
})

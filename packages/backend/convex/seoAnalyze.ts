"use node"

import { ConvexError, v } from "convex/values"
import { action } from "./_generated/server"
import { api } from "./_generated/api"
import { requireRole } from "./lib/authz"
import { MUTATION_REGISTRY } from "./_registry"
import {
  MAX_EXCERPT_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  MAX_POST_BODY_LENGTH,
  MAX_SEO_DESCRIPTION_LENGTH,
  MAX_SEO_TITLE_LENGTH,
  MAX_SLUG_LENGTH,
  MAX_TARGET_KEYWORD_LENGTH,
} from "./content"
import type { SeoFinding } from "./lib/yoastFindings"

function assertLen(value: string, max: number, field: string) {
  if (value.length > max) {
    throw new ConvexError({ code: "FIELD_TOO_LONG", field, max })
  }
}

export const analyze = action({
  args: {
    title: v.string(),
    excerpt: v.string(),
    bodyHtml: v.string(),
    targetKeyword: v.string(),
    seoTitle: v.string(),
    seoDescription: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args): Promise<{ findings: SeoFinding[] }> => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    assertLen(args.title, MAX_PAGE_TITLE_LENGTH, "title")
    assertLen(args.excerpt, MAX_EXCERPT_LENGTH, "excerpt")
    assertLen(args.bodyHtml, MAX_POST_BODY_LENGTH, "body")
    assertLen(args.targetKeyword, MAX_TARGET_KEYWORD_LENGTH, "targetKeyword")
    assertLen(args.seoTitle, MAX_SEO_TITLE_LENGTH, "seo.title")
    assertLen(args.seoDescription, MAX_SEO_DESCRIPTION_LENGTH, "seo.description")
    assertLen(args.slug, MAX_SLUG_LENGTH, "slug")

    // La matrice authz (edge-runtime) ne peut pas charger yoastseo.
    // Le vrai moteur est couvert par yoast/run.test.ts (Node).
    if (process.env.SEO_ANALYZE_STUB === "1") {
      return { findings: [] }
    }

    const { runYoastAnalysis } = await import("./lib/yoastRun.js")
    const webOrigin = process.env.WEB_SITE_URL
    return runYoastAnalysis({
      title: args.title,
      seoTitle: args.seoTitle,
      seoDescription: args.seoDescription || args.excerpt,
      targetKeyword: args.targetKeyword,
      slug: args.slug,
      webOrigin: webOrigin && webOrigin.length > 0 ? webOrigin : undefined,
      bodyHtml: args.bodyHtml,
    })
  },
})

MUTATION_REGISTRY.push({
  name: "seoAnalyze.analyze",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: (t) =>
    t.action(api.seoAnalyze.analyze, {
      title: "Registre",
      excerpt: "",
      bodyHtml: "<p>x</p>",
      targetKeyword: "",
      seoTitle: "",
      seoDescription: "",
      slug: "registre",
    }),
})

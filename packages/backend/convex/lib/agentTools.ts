import { createTool } from "@convex-dev/agent"
import { z } from "zod"
import { internal } from "../_generated/api"
import { fetchPublishedText } from "./publishedPageText"

type PublishedPageRef = { title: string; slug: string }
type PublishedPageRow = PublishedPageRef & { homePageSlug: string | null }
type ReadPageResult =
  | { found: false }
  | { found: true; title: string; slug: string; text: string }

export const listPublishedPages = createTool({
  description: "Liste les pages publiées du site (titre + slug).",
  inputSchema: z.object({}),
  execute: async (ctx): Promise<PublishedPageRef[]> => {
    return await ctx.runQuery(internal.chatStream.publishedPageIndex, {})
  },
})

export const readPublishedPage = createTool({
  description: "Lit le texte d'une page publiée, par son slug.",
  inputSchema: z.object({ slug: z.string() }),
  execute: async (ctx, input): Promise<ReadPageResult> => {
    const page: PublishedPageRow | null = await ctx.runQuery(
      internal.chatStream.publishedPageBySlug,
      { slug: input.slug },
    )
    if (page === null) return { found: false }
    const text = await fetchPublishedText(
      process.env.WEB_SITE_URL,
      page.slug,
      page.homePageSlug,
    )
    if (text === null) return { found: false }
    return { found: true, title: page.title, slug: page.slug, text }
  },
})

export const visitorPageTools = {
  listPublishedPages,
  readPublishedPage,
}

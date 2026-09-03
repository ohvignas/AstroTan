import { createTool } from "@convex-dev/agent"
import { z } from "zod"
import { SITE_RAG_NAMESPACE } from "./ragSources"
import { requireSiteRag } from "./siteRag"

type SearchKnowledgeResult =
  | { found: true; text: string; titles: string[] }
  | { found: false; reason: "UNCONFIGURED" | "EMPTY" | "UNAVAILABLE" }

export const searchKnowledge = createTool({
  description:
    "Cherche un extrait dans la base de savoir et les pages publiées. Ne renvoie jamais un brouillon.",
  inputSchema: z.object({ query: z.string() }),
  execute: async (ctx, input): Promise<SearchKnowledgeResult> => {
    try {
      const rag = await requireSiteRag(ctx)
      const { text, entries } = await rag.search(ctx, {
        namespace: SITE_RAG_NAMESPACE,
        query: input.query,
        limit: 8,
        vectorScoreThreshold: 0.5,
      })
      if (entries.length === 0) return { found: false, reason: "EMPTY" }
      return {
        found: true,
        text,
        titles: entries
          .map((entry) => entry.title)
          .filter((title): title is string => typeof title === "string" && title.length > 0),
      }
    } catch (error) {
      const code =
        error && typeof error === "object" && "data" in error
          ? (error as { data?: { code?: string } }).data?.code
          : undefined
      if (code === "OPENROUTER_NOT_CONFIGURED") {
        return { found: false, reason: "UNCONFIGURED" }
      }
      return { found: false, reason: "UNAVAILABLE" }
    }
  },
})

export const knowledgeTools = { searchKnowledge }

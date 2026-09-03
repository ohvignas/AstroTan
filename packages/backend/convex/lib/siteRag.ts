import { RAG } from "@convex-dev/rag"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { ConvexError } from "convex/values"
import { components } from "../_generated/api"
import type { ActionCtx } from "../_generated/server"
import { lireSecret } from "../secrets"
import {
  SITE_EMBEDDING_DIMENSION,
  SITE_EMBEDDING_MODEL,
  type RagSource,
} from "./ragSources"

export function siteRag(apiKey: string) {
  const openrouter = createOpenRouter({
    apiKey,
    appName: "AstroTan",
    appUrl: process.env.WEB_SITE_URL,
  })
  return new RAG<{ source: RagSource }>(components.rag, {
    textEmbeddingModel: openrouter.textEmbeddingModel(SITE_EMBEDDING_MODEL),
    embeddingDimension: SITE_EMBEDDING_DIMENSION,
    filterNames: ["source"],
  })
}

export async function requireSiteRag(ctx: ActionCtx) {
  const apiKey = await lireSecret(ctx, "OPENROUTER_API_KEY")
  if (!apiKey) throw new ConvexError({ code: "OPENROUTER_NOT_CONFIGURED" })
  return siteRag(apiKey)
}

import type { EntryId } from "@convex-dev/rag"
import type { Id } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import type { ActionCtx } from "../_generated/server"
import { fetchPublishedText } from "./publishedPageText"
import { knowledgeEntries, pageEntry, SITE_RAG_NAMESPACE } from "./ragSources"
import { requireSiteRag, siteRag } from "./siteRag"

type SiteRag = ReturnType<typeof siteRag>

async function deleteNamespaceEntries(ctx: ActionCtx, rag: SiteRag) {
  const namespace = await rag.getNamespace(ctx, { namespace: SITE_RAG_NAMESPACE })
  if (namespace === null) return
  let cursor: string | null = null
  for (;;) {
    const page = await rag.list(ctx, {
      namespaceId: namespace.namespaceId,
      paginationOpts: { numItems: 64, cursor },
    })
    for (const entry of page.page) {
      await rag.delete(ctx, { entryId: entry.entryId as EntryId })
    }
    if (page.isDone) break
    cursor = page.continueCursor
  }
}

export async function runSiteReindex(ctx: ActionCtx) {
  const sources = await ctx.runQuery(internal.rag.indexSources, {})
  const knowledge = knowledgeEntries(sources.files, sources.leftover)
  if (knowledge.length === 0 && sources.pages.length === 0) {
    return { added: 0, pages: 0, knowledge: 0 }
  }
  const rag = await requireSiteRag(ctx)
  await deleteNamespaceEntries(ctx, rag)

  let added = 0
  for (const entry of knowledge) {
    await rag.add(ctx, {
      namespace: SITE_RAG_NAMESPACE,
      key: entry.key,
      title: entry.title,
      text: entry.text,
      filterValues: [{ name: "source", value: entry.source }],
    })
    if (entry.key.startsWith("knowledge:") && entry.key !== "knowledge:settings") {
      await ctx.runMutation(internal.rag.markFileStatus, {
        id: entry.key.slice("knowledge:".length) as Id<"agentKnowledgeFiles">,
        status: "indexed",
      })
    }
    added += 1
  }

  let pages = 0
  for (const page of sources.pages) {
    const text = await fetchPublishedText(
      process.env.WEB_SITE_URL,
      page.slug,
      sources.homePageSlug,
    )
    const entry = pageEntry(page, text)
    if (entry === null) continue
    await rag.add(ctx, {
      namespace: SITE_RAG_NAMESPACE,
      key: entry.key,
      title: entry.title,
      text: entry.text,
      filterValues: [{ name: "source", value: entry.source }],
    })
    pages += 1
    added += 1
  }

  return { added, pages, knowledge: knowledge.length }
}

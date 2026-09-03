import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, expect, test } from "vitest"
import { api, internal } from "../_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../../testing/betterAuthFixture"
import {
  SITE_EMBEDDING_DIMENSION,
  SITE_EMBEDDING_MODEL,
  SITE_RAG_NAMESPACE,
  knowledgeEntries,
  pageEntry,
  publishedPageCandidates,
} from "./ragSources"

const here = dirname(fileURLToPath(import.meta.url))
const ragSource = readFileSync(join(here, "../rag.ts"), "utf8")
const toolsSource = readFileSync(join(here, "knowledgeTools.ts"), "utf8")
const siteRagSource = readFileSync(join(here, "siteRag.ts"), "utf8")

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  delete process.env.OPENROUTER_API_KEY
})

afterEach(() => {
  process.env = originalEnv
})

test("un brouillon n'entre pas dans les sources à indexer", () => {
  const pages = publishedPageCandidates([
    { slug: "accueil", title: "Accueil", status: "published" },
    { slug: "secret", title: "Brouillon", status: "draft" },
  ])
  expect(pages.map((page) => page.slug)).toEqual(["accueil"])
  expect(pages.some((page) => page.slug === "secret")).toBe(false)
})

test("un GET non-200 n'ajoute pas la page", () => {
  expect(pageEntry({ slug: "contact", title: "Contact" }, null)).toBeNull()
  expect(pageEntry({ slug: "contact", title: "Contact" }, "   ")).toBeNull()
  expect(
    pageEntry(
      { slug: "contact", title: "Contact" },
      "Horaires : ouvert du lundi au vendredi, 9h-18h.",
    ),
  ).toEqual({
    key: "page:contact",
    title: "Contact",
    text: "Horaires : ouvert du lundi au vendredi, 9h-18h.",
    source: "page",
  })
})

test("la base de savoir ignore un fichier vide et garde le texte rédigé", () => {
  const entries = knowledgeEntries(
    [
      { id: "file-1", filename: "faq.md", extractedMarkdown: "Le code secret est ORION-42." },
      { id: "file-2", filename: "vide.md", extractedMarkdown: "  " },
    ],
    "  Horaires : 9h-18h  ",
  )
  expect(entries.map((entry) => entry.key)).toEqual(["knowledge:file-1", "knowledge:settings"])
  expect(entries.every((entry) => entry.source === "knowledge")).toBe(true)
})

test("aucun transcript visiteur n'est une source d'index", () => {
  expect(knowledgeEntries([{ id: "x", filename: "chat.json", extractedMarkdown: "" }])).toEqual([])
  expect(siteRagSource).not.toMatch(/chatSessions|leadMessages|transcript/)
  expect(ragSource).not.toMatch(/source:\s*"chat"/)
})

test("searchKnowledge est un outil d'action, pas une query publique", () => {
  expect(toolsSource).toContain("export const searchKnowledge = createTool")
  expect(toolsSource).toContain('namespace: SITE_RAG_NAMESPACE')
  expect(toolsSource).toContain("vectorScoreThreshold: 0.5")
  expect(ragSource).toMatch(/export const reindex = action\(/)
  expect(ragSource).not.toMatch(/export const search = query/)
  expect(ragSource).not.toMatch(/export const search = /)
})

test("l'embedding retenu est OpenRouter text-embedding-3-small, 1536", () => {
  expect(SITE_RAG_NAMESPACE).toBe("site")
  expect(SITE_EMBEDDING_MODEL).toBe("openai/text-embedding-3-small")
  expect(SITE_EMBEDDING_DIMENSION).toBe(1536)
  expect(siteRagSource).toContain("lireSecret")
  expect(siteRagSource).toContain("OPENROUTER_API_KEY")
  expect(siteRagSource).toContain("textEmbeddingModel")
})

test("indexSources exclut un slug brouillon côté Convex", async () => {
  const t = makeTestConvex()
  await t.run(async (ctx) => {
    await ctx.db.insert("pages", {
      slug: "publiee",
      title: "Publiée",
      status: "published",
      createdBy: "user_1",
      updatedBy: "user_1",
    })
    await ctx.db.insert("pages", {
      slug: "brouillon-rag",
      title: "Ne pas indexer",
      status: "draft",
      createdBy: "user_1",
      updatedBy: "user_1",
    })
    await ctx.db.insert("settings", { siteName: "AstroTan", agentKnowledge: "Texte rédigé" })
  })

  const sources = await t.query(internal.rag.indexSources, {})
  expect(sources.pages.map((page) => page.slug)).toEqual(["publiee"])
  expect(sources.pages.some((page) => page.slug === "brouillon-rag")).toBe(false)
  expect(sources.leftover).toBe("Texte rédigé")
})

test("un editor ne relance pas l'index", async () => {
  const t = makeTestConvex()
  const email = `rag-editor-${Date.now()}@example.com`
  const password = "correct horse battery staple rag"
  const user = await seedUser(t, { email, password, name: "Editor", role: "editor" })
  await signIn(t, email, password)
  const editor = await identityFor(t, user.id)
  await expect(editor.action(api.rag.reindex, {})).rejects.toThrow()
})

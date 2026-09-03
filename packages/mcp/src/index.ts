import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { requireEnv } from "./client.js"
import { runTool, TOOL_NAMES, type ToolName } from "./tools.js"

requireEnv()

const DESCRIPTIONS: Record<ToolName, string> = {
  list_posts: "Lister les articles",
  get_post: "Lire un article",
  create_post: "Créer un brouillon",
  update_post: "Modifier un article (published → workingCopy)",
  delete_post: "Supprimer un article",
  publish_post: "Publier un article",
  unpublish_post: "Dépublier un article",
  list_leads: "Lister les fiches de contact",
  get_lead: "Lire une fiche",
  list_pages: "Lister les pages (méta seulement)",
  get_page: "Lire les méta d'une page",
  update_page: "Modifier titre / SEO / GEO d'une page",
  list_tags: "Lister les tags",
  create_tag: "Créer un tag",
}

const idShape = { id: z.string() }
const emptyShape = {}

function asText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] }
}

const server = new McpServer({ name: "astrotan", version: "1.0.0" })

for (const name of TOOL_NAMES) {
  const needsId = name !== "list_posts" && name !== "list_leads" && name !== "list_pages" && name !== "list_tags" && name !== "create_post" && name !== "create_tag"
  const shape = needsId
    ? idShape
    : name === "create_post"
      ? { title: z.string(), slug: z.string() }
      : name === "create_tag"
        ? { name: z.string() }
        : emptyShape
  server.tool(name, DESCRIPTIONS[name], shape, async (args) =>
    asText(await runTool(name, args as Record<string, unknown>)),
  )
}

const transport = new StdioServerTransport()
await server.connect(transport)

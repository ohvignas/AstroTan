import { tool, type ToolSet } from "ai"
import { z } from "zod"
import {
  connectMcpServer,
  MCP_HANDSHAKE_TIMEOUT_MS,
  safeMcpError,
  type McpCreateClient,
  type McpListedTool,
  type McpTimeoutOptions,
} from "./loadMcpTools"
import { withTimeout } from "./streamTools"
import { internal } from "../_generated/api"
import type { ActionCtx } from "../_generated/server"

export const LIST_MCP_TOOLS = "list_mcp_tools"
export const CALL_MCP_TOOL = "call_mcp_tool"

const SHORT_DESCRIPTION = 180
const CATALOG_PAGE_CAP = 8

export type McpCatalogEntry = { name: string; description: string }

export function createMcpMetaTools(
  ctx: ActionCtx,
  createClient: McpCreateClient,
  options?: McpTimeoutOptions,
): ToolSet {
  return {
    [LIST_MCP_TOOLS]: tool({
      description:
        "Liste les outils des serveurs MCP connectés (Make, Notion, …) : nom et description courte. À appeler avant d'utiliser un outil externe.",
      inputSchema: z.object({}),
      execute: async () => listMcpCatalog(ctx, createClient, options),
    }),
    [CALL_MCP_TOOL]: tool({
      description:
        "Exécute un outil MCP par son nom (ex. Make__scenarios_list). arguments : objet JSON attendu par l'outil. Utiliser list_mcp_tools pour découvrir les noms.",
      inputSchema: z.object({
        name: z.string(),
        arguments: z.record(z.unknown()).optional(),
      }),
      execute: async ({ name, arguments: args }) => {
        return callNamedMcpTool(ctx, createClient, name, args ?? {}, options)
      },
    }),
  }
}

export async function listMcpCatalog(
  ctx: ActionCtx,
  createClient: McpCreateClient,
  options?: McpTimeoutOptions,
): Promise<{ tools: McpCatalogEntry[] }> {
  const timeoutMs = options?.timeoutMs ?? MCP_HANDSHAKE_TIMEOUT_MS
  const rows = await ctx.runQuery(internal.mcpServers.enabledForStream, {})
  const tools: McpCatalogEntry[] = []

  for (const server of rows) {
    try {
      const { client } = await connectMcpServer(
        ctx,
        createClient,
        server,
        undefined,
        timeoutMs,
      )
      try {
        const listed = await listToolInfos(client, timeoutMs, server.name)
        for (const info of listed) {
          tools.push({
            name: `${server.name}__${info.name}`,
            description: shortDescription(info.description ?? info.title ?? ""),
          })
        }
      } finally {
        try {
          await client.close()
        } catch {
          // fermeture best-effort
        }
      }
    } catch (error) {
      console.warn(`mcp:${server.name}: ${safeMcpError(error)}`)
    }
  }

  return { tools }
}

export async function callNamedMcpTool(
  ctx: ActionCtx,
  createClient: McpCreateClient,
  qualifiedName: string,
  args: Record<string, unknown>,
  options?: McpTimeoutOptions,
): Promise<unknown> {
  const timeoutMs = options?.timeoutMs ?? MCP_HANDSHAKE_TIMEOUT_MS
  const rows = await ctx.runQuery(internal.mcpServers.enabledForStream, {})
  const { serverName, toolName } = splitQualifiedName(qualifiedName, rows)
  const server = rows.find((row) => row.name === serverName)
  if (!server) {
    return { error: `unknown MCP server for ${qualifiedName}` }
  }

  const { client } = await connectMcpServer(
    ctx,
    createClient,
    server,
    undefined,
    timeoutMs,
  )
  try {
    if (typeof client.callTool === "function") {
      return await client.callTool({ name: toolName, arguments: args })
    }
    const set = await withTimeout(client.tools(), timeoutMs, `mcp tools ${server.name}`)
    const found = set[toolName]
    const execute =
      found && typeof found === "object" && "execute" in found ? found.execute : undefined
    if (typeof execute !== "function") {
      return { error: `unknown MCP tool ${qualifiedName}` }
    }
    const run = execute as (input: unknown, options: unknown) => Promise<unknown>
    return await run(args, {})
  } finally {
    try {
      await client.close()
    } catch {
      // fermeture best-effort
    }
  }
}

function shortDescription(raw: string): string {
  const oneLine = raw.replace(/\s+/g, " ").trim()
  if (oneLine.length <= SHORT_DESCRIPTION) return oneLine
  return `${oneLine.slice(0, SHORT_DESCRIPTION - 1)}…`
}

function splitQualifiedName(
  qualifiedName: string,
  rows: Array<{ name: string }>,
): { serverName: string; toolName: string } {
  const match = rows.find((row) => qualifiedName.startsWith(`${row.name}__`))
  if (match) {
    return { serverName: match.name, toolName: qualifiedName.slice(match.name.length + 2) }
  }
  const sep = qualifiedName.indexOf("__")
  if (sep > 0) {
    return {
      serverName: qualifiedName.slice(0, sep),
      toolName: qualifiedName.slice(sep + 2),
    }
  }
  return { serverName: rows[0]?.name ?? "", toolName: qualifiedName }
}

async function listToolInfos(
  client: {
    tools: () => Promise<ToolSet>
    listTools?: (options?: {
      params?: { cursor?: string }
    }) => Promise<{ tools: McpListedTool[]; nextCursor?: string }>
  },
  timeoutMs: number,
  serverName: string,
): Promise<McpListedTool[]> {
  if (!client.listTools) {
    const set = await withTimeout(client.tools(), timeoutMs, `mcp tools ${serverName}`)
    return Object.entries(set).map(([name, value]) => ({
      name,
      description:
        value && typeof value === "object" && "description" in value
          ? String(value.description ?? "")
          : "",
    }))
  }

  const collected: McpListedTool[] = []
  let cursor: string | undefined
  for (let page = 0; page < CATALOG_PAGE_CAP; page++) {
    const result = await withTimeout(
      client.listTools(cursor ? { params: { cursor } } : undefined),
      timeoutMs,
      `mcp list ${serverName}`,
    )
    collected.push(...result.tools)
    if (!result.nextCursor) break
    cursor = result.nextCursor
  }
  return collected
}

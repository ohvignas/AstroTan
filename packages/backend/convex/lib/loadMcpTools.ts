import type { ToolSet } from "ai"
import {
  expiresAtFromExpiresIn,
  mcpHttpHeaders,
  parseMcpSecretPayload,
  prefersStreamableHttp,
  refreshMcpAccessToken,
  serializeMcpSecretPayload,
  shouldRefreshMcpAccess,
} from "./mcpOAuth"
import { chiffrer, dechiffrer, lireCleMaitresse } from "./secretsCrypto"
import { withTimeout } from "./streamTools"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import type { ActionCtx } from "../_generated/server"

export type McpListedTool = {
  name: string
  description?: string
  title?: string
}

type McpClient = {
  tools: () => Promise<ToolSet>
  listTools?: (options?: {
    params?: { cursor?: string }
  }) => Promise<{ tools: McpListedTool[]; nextCursor?: string }>
  callTool?: (args: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>
  close: () => Promise<void>
}

export type McpCreateClient = (args: {
  transport: { type: "http" | "sse"; url: string; headers?: Record<string, string> }
}) => Promise<McpClient>

export type McpServerProbe = {
  name: string
  url: string
  ok: boolean
  toolNames: string[]
  error?: string
  transport?: "http" | "sse"
  headerNames?: string[]
  hasRefresh?: boolean
  hasExpiresAt?: boolean
}

export const MCP_HANDSHAKE_TIMEOUT_MS = 8_000

export type McpTimeoutOptions = { timeoutMs?: number }

export function safeMcpError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
}

export async function loadMcpTools(
  ctx: ActionCtx,
  createClient: McpCreateClient,
  options?: McpTimeoutOptions,
): Promise<{ tools: ToolSet; close: () => Promise<void> }> {
  const timeoutMs = options?.timeoutMs ?? MCP_HANDSHAKE_TIMEOUT_MS
  const rows = await ctx.runQuery(internal.mcpServers.enabledForStream, {})
  const clients: McpClient[] = []
  const tools: ToolSet = {}

  for (const server of rows) {
    try {
      const { client } = await connectMcpServer(ctx, createClient, server, undefined, timeoutMs)
      clients.push(client)
      const set = await withTimeout(client.tools(), timeoutMs, `mcp tools ${server.name}`)
      for (const [name, tool] of Object.entries(set)) {
        tools[`${server.name}__${name}`] = tool
      }
    } catch (error) {
      console.warn(`mcp:${server.name}: ${safeMcpError(error)}`)
    }
  }

  return { tools, close: closeAll(clients) }
}

export async function probeEnabledMcpServers(
  ctx: ActionCtx,
  createClient: McpCreateClient,
  options?: McpTimeoutOptions,
): Promise<{ servers: McpServerProbe[]; close: () => Promise<void> }> {
  const timeoutMs = options?.timeoutMs ?? MCP_HANDSHAKE_TIMEOUT_MS
  const rows = await ctx.runQuery(internal.mcpServers.enabledForStream, {})
  const clients: McpClient[] = []
  const servers: McpServerProbe[] = []

  for (const server of rows) {
    const { headers, hasRefresh, hasExpiresAt } = await readSecretMeta(ctx, server._id)
    const headerNames = headers ? Object.keys(headers).sort() : []
    try {
      const { client, transport, url } = await connectMcpServer(
        ctx,
        createClient,
        server,
        headers,
        timeoutMs,
      )
      clients.push(client)
      const toolNames = client.listTools
        ? (await withTimeout(client.listTools(), timeoutMs, `mcp list ${server.name}`)).tools.map(
            (tool) => tool.name,
          )
        : Object.keys(await withTimeout(client.tools(), timeoutMs, `mcp tools ${server.name}`))
      servers.push({
        name: server.name,
        url,
        ok: true,
        toolNames,
        transport,
        headerNames,
        hasRefresh,
        hasExpiresAt,
      })
    } catch (error) {
      servers.push({
        name: server.name,
        url: server.url,
        ok: false,
        toolNames: [],
        error: safeMcpError(error),
        transport: server.transport,
        headerNames,
        hasRefresh,
        hasExpiresAt,
      })
    }
  }

  return { servers, close: closeAll(clients) }
}

export async function connectMcpServer(
  ctx: ActionCtx,
  createClient: McpCreateClient,
  server: { _id: Id<"mcpServers">; transport: "http" | "sse"; url: string },
  headers?: Record<string, string>,
  timeoutMs = MCP_HANDSHAKE_TIMEOUT_MS,
): Promise<{ client: McpClient; transport: "http" | "sse"; url: string }> {
  const resolved = headers ?? (await readHeaders(ctx, server._id))
  const attempts = connectionAttempts(server)
  let lastError: unknown
  for (const attempt of attempts) {
    const pending = createClient({
      transport: { type: attempt.transport, url: attempt.url, headers: resolved },
    })
    try {
      const client = await withTimeout(pending, timeoutMs, `mcp handshake ${attempt.transport}`)
      if (attempt.transport !== server.transport) {
        await ctx.runMutation(internal.mcpServers.rememberTransport, {
          id: server._id,
          transport: attempt.transport,
        })
      }
      return { client, transport: attempt.transport, url: attempt.url }
    } catch (error) {
      void pending.then((client) => client.close()).catch(() => {})
      lastError = error
      if (isUnauthorized(error) || !isWrongTransport(error)) throw error
    }
  }
  throw lastError
}

function connectionAttempts(server: {
  transport: "http" | "sse"
  url: string
}): Array<{ transport: "http" | "sse"; url: string }> {
  const first = prefersStreamableHttp(server.url) ? "http" : server.transport
  const other = first === "sse" ? "http" : "sse"
  return [
    { transport: first, url: server.url },
    { transport: other, url: server.url },
  ]
}

function isUnauthorized(error: unknown): boolean {
  return /401|Unauthorized/i.test(safeMcpError(error))
}

function isWrongTransport(error: unknown): boolean {
  const raw = safeMcpError(error)
  if (isUnauthorized(error)) return false
  return /404|405|not an SSE endpoint|wrong transport|method not allowed/i.test(raw)
}

function closeAll(clients: McpClient[]): () => Promise<void> {
  return async () => {
    await Promise.all(
      clients.map(async (client) => {
        try {
          await client.close()
        } catch {
          // fermeture best-effort
        }
      }),
    )
  }
}

async function peekSecretKeys(
  ctx: ActionCtx,
  serverId: Id<"mcpServers">,
): Promise<{ hasRefresh: boolean; hasExpiresAt: boolean }> {
  const empty = { hasRefresh: false, hasExpiresAt: false }
  const row = await ctx.runQuery(internal.mcpServers.headersBrut, { serverId })
  if (row === null) return empty
  const cle = lireCleMaitresse(process.env)
  if (!cle.ok) return empty
  try {
    const parsed: unknown = JSON.parse(await dechiffrer(cle.octets, row.iv, row.chiffre))
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return empty
    const keys = Object.keys(parsed)
    return { hasRefresh: keys.includes("refresh_token"), hasExpiresAt: keys.includes("expires_at") }
  } catch {
    return empty
  }
}

async function readSecretMeta(
  ctx: ActionCtx,
  serverId: Id<"mcpServers">,
): Promise<{
  headers: Record<string, string> | undefined
  hasRefresh: boolean
  hasExpiresAt: boolean
}> {
  const flags = await peekSecretKeys(ctx, serverId)
  return { headers: await readHeaders(ctx, serverId), ...flags }
}

async function readHeaders(
  ctx: ActionCtx,
  serverId: Id<"mcpServers">,
): Promise<Record<string, string> | undefined> {
  const row = await ctx.runQuery(internal.mcpServers.headersBrut, { serverId })
  if (row === null) return undefined
  const cle = lireCleMaitresse(process.env)
  if (!cle.ok) return undefined
  let payload
  try {
    payload = parseMcpSecretPayload(await dechiffrer(cle.octets, row.iv, row.chiffre))
  } catch {
    return undefined
  }
  if (payload === null) return undefined
  const oauth = payload.oauth
  if (oauth && shouldRefreshMcpAccess(oauth)) {
    try {
      const tokens = await refreshMcpAccessToken({
        tokenEndpoint: oauth.token_endpoint,
        refreshToken: oauth.refresh_token,
        clientId: oauth.client_id,
        clientSecret: oauth.client_secret,
        resource: oauth.resource,
      })
      const next = serializeMcpSecretPayload({
        accessToken: tokens.accessToken,
        oauth: {
          refreshToken: tokens.refreshToken ?? oauth.refresh_token,
          expiresAt: expiresAtFromExpiresIn(tokens.expiresIn),
          tokenEndpoint: oauth.token_endpoint,
          clientId: oauth.client_id,
          clientSecret: oauth.client_secret,
          resource: oauth.resource,
        },
      })
      const { iv, chiffre } = await chiffrer(cle.octets, next)
      await ctx.runMutation(internal.mcpServers.rangerHeaders, {
        serverId,
        iv,
        chiffre,
        majPar: row.majPar,
      })
      payload = parseMcpSecretPayload(next)
    } catch (error) {
      console.warn(`mcp:refresh: ${safeMcpError(error)}`)
    }
  }
  return mcpHttpHeaders(payload)
}

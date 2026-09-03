import { ConvexError, v } from "convex/values"
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { internal } from "./_generated/api"
import "./lib/mcpServersRegistry"
import type { Id } from "./_generated/dataModel"
import { MAX_MCP_AUTHORIZE_URL, MAX_MCP_SERVER_NAME, MAX_MCP_SERVER_URL } from "./content"
import { requireRole } from "./lib/authz"
import { assertMcpUrl } from "./lib/mcpUrl"
import { chiffrer, lireCleMaitresse, SECRETS_KEY_COMMANDE } from "./lib/secretsCrypto"

function assertLength(value: string, max: number, field: string): void {
  if (value.length > max) throw new ConvexError({ code: "FIELD_TOO_LONG", field, max })
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const rows = await ctx.db.query("mcpServers").collect()
    const secrets = await ctx.db.query("mcpSecrets").collect()
    const withHeaders = new Set(secrets.map((row) => row.serverId))
    return rows.map((row) => ({
      _id: row._id,
      name: row.name,
      transport: row.transport,
      url: row.url,
      enabled: row.enabled,
      authorizeUrl: row.authorizeUrl ?? null,
      headersConfigured: withHeaders.has(row._id),
    }))
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    transport: v.string(),
    url: v.string(),
    authorizeUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await requireRole(ctx, ["owner", "admin"])
    // `http` = Streamable HTTP, `sse` = HTTP+SSE. Pas de fichier / stdio :
    // un mcp.json n'est pas un transport distant.
    if (args.transport !== "http" && args.transport !== "sse") {
      throw new ConvexError({ code: "MCP_TRANSPORT" })
    }
    const name = args.name.trim()
    const url = args.url.trim()
    if (name.length === 0) throw new ConvexError({ code: "EMPTY" })
    assertLength(name, MAX_MCP_SERVER_NAME, "name")
    assertLength(url, MAX_MCP_SERVER_URL, "url")
    if (assertMcpUrl(url) !== "ok") throw new ConvexError({ code: "MCP_URL" })
    const authorize = args.authorizeUrl?.trim() ?? ""
    if (authorize.length > 0) {
      assertLength(authorize, MAX_MCP_AUTHORIZE_URL, "authorizeUrl")
      if (assertMcpUrl(authorize) !== "ok") throw new ConvexError({ code: "MCP_URL" })
    }
    return ctx.db.insert("mcpServers", {
      name,
      transport: args.transport,
      url,
      enabled: true,
      createdBy: authUser._id,
      ...(authorize.length > 0 ? { authorizeUrl: authorize } : {}),
    })
  },
})

export const remove = mutation({
  args: { id: v.id("mcpServers") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])
    const secret = await ctx.db
      .query("mcpSecrets")
      .withIndex("by_server", (q) => q.eq("serverId", args.id))
      .unique()
    if (secret) await ctx.db.delete(secret._id)
    await ctx.db.delete(args.id)
    return null
  },
})

export const setEnabled = mutation({
  args: { id: v.id("mcpServers"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])
    const row = await ctx.db.get(args.id)
    if (row === null) throw new ConvexError({ code: "NOT_FOUND" })
    await ctx.db.patch(args.id, { enabled: args.enabled })
    return null
  },
})

export const setHeaders = action({
  args: { id: v.id("mcpServers"), headersJson: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const acteur = await requireRole(ctx, ["owner", "admin"])
    const raw = args.headersJson.trim()
    if (raw.length === 0) throw new ConvexError({ code: "EMPTY_SECRET" })
    try {
      JSON.parse(raw)
    } catch {
      throw new ConvexError({ code: "MCP_HEADERS" })
    }
    const cle = lireCleMaitresse(process.env)
    if (!cle.ok) {
      throw new ConvexError({
        code: cle.raison === "MISSING" ? "SECRETS_KEY_MISSING" : "SECRETS_KEY_MALFORMED",
        commande: SECRETS_KEY_COMMANDE,
      })
    }
    const { iv, chiffre } = await chiffrer(cle.octets, raw)
    await ctx.runMutation(internal.mcpServers.rangerHeaders, {
      serverId: args.id,
      iv,
      chiffre,
      majPar: acteur._id,
    })
    return null
  },
})

export const rangerHeaders = internalMutation({
  args: {
    serverId: v.id("mcpServers"),
    iv: v.bytes(),
    chiffre: v.bytes(),
    majPar: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcpSecrets")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .unique()
    const patch = { iv: args.iv, chiffre: args.chiffre, majPar: args.majPar, majAt: Date.now() }
    if (existing) {
      await ctx.db.patch(existing._id, patch)
      return existing._id
    }
    return ctx.db.insert("mcpSecrets", { serverId: args.serverId, ...patch })
  },
})

export const headersBrut = internalQuery({
  args: { serverId: v.id("mcpServers") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("mcpSecrets")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .unique()
    if (row === null) return null
    return { iv: row.iv, chiffre: row.chiffre, majPar: row.majPar }
  },
})

export const rememberTransport = internalMutation({
  args: {
    id: v.id("mcpServers"),
    transport: v.union(v.literal("http"), v.literal("sse")),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (row === null) return null
    if (row.transport === args.transport) return null
    await ctx.db.patch(args.id, { transport: args.transport })
    return null
  },
})

export const enabledForStream = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("mcpServers")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect()
    return rows.map((row) => ({
      _id: row._id as Id<"mcpServers">,
      name: row.name,
      transport: row.transport,
      url: row.url,
    }))
  },
})

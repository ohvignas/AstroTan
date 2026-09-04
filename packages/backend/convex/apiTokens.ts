import { mutation, query } from "./_generated/server"
import { api } from "./_generated/api"
import { requireRole } from "./lib/authz"
import { generateToken } from "./lib/token"
import { journaliser } from "./lib/auditEvent"
import { MUTATION_REGISTRY } from "./_registry"

const CIBLE = "api"

export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin"])
    const row = await ctx.db.query("apiTokens").first()
    if (row === null) return { configured: false as const, createdAt: null, last3: null }
    return { configured: true as const, createdAt: row.createdAt, last3: row.last3 ?? null }
  },
})

export const generate = mutation({
  args: {},
  handler: async (ctx) => {
    const acteur = await requireRole(ctx, ["owner", "admin"])
    const { token, hash } = await generateToken()
    const existing = await ctx.db.query("apiTokens").collect()
    for (const row of existing) {
      await ctx.db.delete(row._id)
    }
    await ctx.db.insert("apiTokens", {
      tokenHash: hash,
      last3: token.slice(-3),
      createdBy: acteur._id,
      createdAt: Date.now(),
    })
    await journaliser(ctx, {
      acteur,
      action: "apiToken.generate",
      cible: CIBLE,
      detail: existing.length > 0 ? "remplacement" : "création",
    })
    return { token }
  },
})

export const revoke = mutation({
  args: {},
  handler: async (ctx) => {
    const acteur = await requireRole(ctx, ["owner", "admin"])
    const existing = await ctx.db.query("apiTokens").collect()
    for (const row of existing) {
      await ctx.db.delete(row._id)
    }
    if (existing.length > 0) {
      await journaliser(ctx, {
        acteur,
        action: "apiToken.revoke",
        cible: CIBLE,
      })
    }
  },
})

MUTATION_REGISTRY.push(
  {
    name: "apiTokens.generate",
    allowedRoles: ["owner", "admin"],
    invoke: (t) => t.mutation(api.apiTokens.generate, {}),
  },
  {
    name: "apiTokens.revoke",
    allowedRoles: ["owner", "admin"],
    invoke: (t) => t.mutation(api.apiTokens.revoke, {}),
  },
)

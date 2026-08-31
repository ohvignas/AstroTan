import type { QueryCtx } from "../_generated/server"

async function sourceAutreQueAucune(
  ctx: QueryCtx,
  nom: "DATAFORSEO_LOGIN" | "DATAFORSEO_PASSWORD",
): Promise<boolean> {
  if (process.env[nom]) return true
  const row = await ctx.db
    .query("secrets")
    .withIndex("by_nom", (q) => q.eq("nom", nom))
    .unique()
  return row !== null
}

/** Même règle que `estDataForSeoConfigure` : les deux sources ≠ `aucune`. */
export async function dataforseoEstConfigure(ctx: QueryCtx): Promise<boolean> {
  const [login, password] = await Promise.all([
    sourceAutreQueAucune(ctx, "DATAFORSEO_LOGIN"),
    sourceAutreQueAucune(ctx, "DATAFORSEO_PASSWORD"),
  ])
  return login && password
}

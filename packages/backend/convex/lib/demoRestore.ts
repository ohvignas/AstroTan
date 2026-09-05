import { ConvexError } from "convex/values"
import { components } from "../_generated/api"
import type { MutationCtx } from "../_generated/server"
import { createAuth } from "../auth"

export function compteDemoPret(env: Record<string, string | undefined>): boolean {
  return Boolean(env.DEMO_ACCOUNT_EMAIL && env.DEMO_ACCOUNT_PASSWORD)
}

export async function trouverCompteDemo(
  ctx: MutationCtx,
  email: string,
): Promise<string | null> {
  const existing = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user" as const,
    where: [{ field: "email" as const, operator: "eq" as const, value: email }],
  })
  if (!existing) return null
  return String((existing as { _id: string })._id)
}

export async function creerEditorDemo(
  ctx: MutationCtx,
  email: string,
  password: string,
): Promise<string> {
  const auth = createAuth(ctx)
  const result = await auth.api.createUser({
    body: { email, password, name: "Démo", role: "editor" },
  })
  return (result as { user: { id: string } }).user.id
}

export async function assurerCompteDemo(
  ctx: MutationCtx,
  env: Record<string, string | undefined>,
): Promise<string> {
  if (!compteDemoPret(env)) throw new ConvexError({ code: "DEMO_NOT_CONFIGURED" })
  const email = env.DEMO_ACCOUNT_EMAIL!.trim().toLowerCase()
  const existing = await trouverCompteDemo(ctx, email)
  if (existing) return existing
  return creerEditorDemo(ctx, email, env.DEMO_ACCOUNT_PASSWORD!)
}

export async function supprimerArticlesDuCompte(
  ctx: MutationCtx,
  userId: string,
): Promise<void> {
  const posts = await ctx.db
    .query("posts")
    .withIndex("by_created_by", (q) => q.eq("createdBy", userId))
    .collect()
  for (const post of posts) {
    await ctx.db.delete(post._id)
  }
}

export async function supprimerMediasDuCompte(
  ctx: MutationCtx,
  userId: string,
): Promise<void> {
  const medias = await ctx.db
    .query("media")
    .withIndex("by_created_by", (q) => q.eq("createdBy", userId))
    .collect()
  for (const media of medias) {
    await ctx.storage.delete(media.storageId)
    await ctx.db.delete(media._id)
  }
}

export async function revoquerSessionsDuCompte(
  ctx: MutationCtx,
  userId: string,
): Promise<void> {
  // `deleteMany` pagine comme `findMany` : `paginationOpts` est exigé par
  // l'adaptateur (`createApi`), même si les types générés l'omettent.
  let cursor: string | null = null
  for (;;) {
    const page: { isDone: boolean; continueCursor: string } = await ctx.runMutation(
      components.betterAuth.adapter.deleteMany,
      {
        input: {
          model: "session" as const,
          where: [{ field: "userId" as const, operator: "eq" as const, value: userId }],
        },
        paginationOpts: { numItems: 100, cursor },
      },
    )
    if (page.isDone) return
    cursor = page.continueCursor
  }
}

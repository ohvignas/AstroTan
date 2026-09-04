import { components } from "../_generated/api"
import type { QueryCtx } from "../_generated/server"

export type PostAuthor = {
  displayName: string
  email: string
}

/**
 * `createdBy` est l'id Better Auth de qui a écrit l'article. Le nom vient
 * du profil (`users.list` fait le même repli) ; l'email du compte si le
 * profil manque — un seed ou un compte supprimé n'ont parfois plus que ça.
 */
export async function resolvePostAuthors(
  ctx: QueryCtx,
  createdByIds: string[],
): Promise<Map<string, PostAuthor>> {
  const unique = [...new Set(createdByIds)]
  const profiles = await ctx.db.query("profiles").collect()
  const byAuthId = new Map(profiles.map((profile) => [profile.authUserId, profile]))

  const authors = new Map<string, PostAuthor>()
  for (const id of unique) {
    const profile = byAuthId.get(id)
    const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user" as const,
      where: [{ field: "_id", value: id }],
    })
    const email = typeof user?.email === "string" ? user.email : ""
    authors.set(id, {
      displayName: profile?.displayName || email || "—",
      email,
    })
  }
  return authors
}

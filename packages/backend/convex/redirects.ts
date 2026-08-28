import { ConvexError, v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { api } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { requireRole } from "./lib/authz"
import { assertSafeHref } from "./lib/safeHref"
import { assertPathAvailable } from "./lib/servedPaths"
import { normalizeSlug } from "./lib/slug"
import { RESERVED_PAGE_SLUGS } from "./posts"
import { MUTATION_REGISTRY } from "./_registry"

// Redirects, and the one property that makes them safe.
//
//   A redirect can never make live content unreachable.
//
// The middleware runs before the route, so a redirect claiming a path that
// something already answers on simply swallows it — no error, no trace, and
// the operator finds out from a visitor. The check therefore happens at
// write time, at every point where the pair (redirect, content) can be
// brought into conflict.
//
// There are three such points, not two, and the third is the one that gets
// missed: `create`, the slug side (`pages`/`posts`), and **re-enabling a
// disabled redirect**. Without the third, this sequence walks through
// untouched — create the redirect while nothing answers that path, disable
// it, create the page (accepted, the redirect is inactive), re-enable it,
// and the page is shadowed having never failed a single check.

export const MAX_REDIRECT_PATH_LENGTH = 2048

/**
 * Everything a redirect must satisfy before it can be stored or re-enabled.
 *
 * Shared by `create` and by `update`, so the third write point cannot drift
 * from the first — which is exactly how it went missing the first time.
 */
async function assertRedirectUsable(
  ctx: MutationCtx,
  from: string,
  to: string
): Promise<void> {
  if (from.length === 0) throw new ConvexError({ code: "INVALID_FROM" })
  if (from.length > MAX_REDIRECT_PATH_LENGTH || to.length > MAX_REDIRECT_PATH_LENGTH) {
    throw new ConvexError({
      code: "FIELD_TOO_LONG",
      field: "path",
      max: MAX_REDIRECT_PATH_LENGTH,
    })
  }
  assertSafeHref(to, "to")

  // A redirect to itself is an infinite loop the browser turns into an
  // error page — worse than the 404 it was meant to fix.
  if (normalizeSlug(to) === from) throw new ConvexError({ code: "REDIRECT_LOOP" })

  await assertPathAvailable(ctx, from, RESERVED_PAGE_SLUGS)
}

async function findByFrom(ctx: MutationCtx, from: string) {
  return ctx.db
    .query("redirects")
    .withIndex("by_from", (q) => q.eq("from", from))
    .unique()
}

/**
 * The active redirects, readable without a session.
 *
 * `apps/web`'s middleware has no session and no admin key, and it needs the
 * whole active set to answer any request. Disabled rows are filtered here,
 * in the query — a middleware that had to filter them itself is a middleware
 * that can forget to.
 */
export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("redirects").collect()
    return rows
      .filter((row) => row.enabled)
      .map((row) => ({ from: row.from, to: row.to, code: row.code }))
  },
})

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin"])
    const rows = await ctx.db.query("redirects").collect()
    return rows.sort((a, b) => a.from.localeCompare(b.from, "fr"))
  },
})

export const create = mutation({
  args: {
    from: v.string(),
    to: v.string(),
    code: v.union(v.literal(301), v.literal(302)),
  },
  handler: async (ctx, args) => {
    // Owner/admin only: a redirect changes what every visitor of the site
    // sees, which is not an editor's call.
    const authUser = await requireRole(ctx, ["owner", "admin"])

    const from = normalizeSlug(args.from)
    const to = args.to.trim()
    await assertRedirectUsable(ctx, from, to)

    if ((await findByFrom(ctx, from)) !== null) {
      throw new ConvexError({ code: "FROM_ALREADY_EXISTS", from })
    }

    return ctx.db.insert("redirects", {
      from,
      to,
      code: args.code,
      enabled: true,
      createdBy: authUser._id,
    })
  },
})

export const update = mutation({
  args: {
    id: v.id("redirects"),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    code: v.optional(v.union(v.literal(301), v.literal(302))),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])
    const row = await ctx.db.get(args.id)
    if (!row) throw new ConvexError({ code: "NOT_FOUND" })

    const from = args.from !== undefined ? normalizeSlug(args.from) : row.from
    const to = args.to !== undefined ? args.to.trim() : row.to
    const enabled = args.enabled ?? row.enabled

    // The third write point. Re-checked whenever the row will END UP
    // active — whether it is being enabled now or was already — because
    // the world may have changed since it was written. Skipped for a row
    // that stays disabled: a disabled redirect shadows nothing, and
    // refusing to save one would make it impossible to fix.
    if (enabled) {
      await assertRedirectUsable(ctx, from, to)
    }

    if (from !== row.from) {
      const clash = await findByFrom(ctx, from)
      if (clash !== null && clash._id !== args.id) {
        throw new ConvexError({ code: "FROM_ALREADY_EXISTS", from })
      }
    }

    await ctx.db.patch(args.id, {
      from,
      to,
      code: args.code ?? row.code,
      enabled,
    })
  },
})

export const remove = mutation({
  args: { id: v.id("redirects") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])
    const row = await ctx.db.get(args.id)
    if (!row) throw new ConvexError({ code: "NOT_FOUND" })
    await ctx.db.delete(args.id)
  },
})

/**
 * Mint the 301 that keeps a renamed page reachable at its old URL.
 *
 * Called by `pages.update`/`posts.update`, never by a client — which is why
 * it takes a plain `MutationCtx` rather than being a mutation of its own.
 *
 * Silent when the old path is already claimed: renaming a slug back and
 * forth would otherwise fail on the second rename, and a rename refusing
 * itself over its own bookkeeping is worse than a missing redirect.
 */
export async function mintRenameRedirect(
  ctx: MutationCtx,
  oldSlug: string,
  newSlug: string,
  createdBy: string
): Promise<Id<"redirects"> | null> {
  if (oldSlug === newSlug) return null
  if ((await findByFrom(ctx, oldSlug)) !== null) return null
  try {
    await assertRedirectUsable(ctx, oldSlug, `/${newSlug}`)
  } catch {
    return null
  }
  return ctx.db.insert("redirects", {
    from: oldSlug,
    to: `/${newSlug}`,
    code: 301,
    enabled: true,
    createdBy,
  })
}

MUTATION_REGISTRY.push(
  {
    name: "redirects.create",
    allowedRoles: ["owner", "admin"],
    invoke: (t) =>
      t.mutation(api.redirects.create, {
        from: `registry-${Date.now()}-${Math.random()}`,
        to: "/tarifs",
        code: 301,
      }),
  },
  {
    name: "redirects.update",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const id = await t.mutation(api.redirects.create, {
        from: `registry-${Date.now()}-${Math.random()}`,
        to: "/tarifs",
        code: 301,
      })
      return t.mutation(api.redirects.update, { id, enabled: false })
    },
  },
  {
    name: "redirects.remove",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const id = await t.mutation(api.redirects.create, {
        from: `registry-${Date.now()}-${Math.random()}`,
        to: "/tarifs",
        code: 301,
      })
      return t.mutation(api.redirects.remove, { id })
    },
  }
)

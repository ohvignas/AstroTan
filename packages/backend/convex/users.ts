import { ConvexError, v } from "convex/values"
import type { GenericDocument, PaginationResult } from "convex/server"
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import { api, components } from "./_generated/api"
import { requireRole } from "./lib/authz"
import { assertOwnerInvariant, OwnerInvariantError } from "./lib/ownerGuard"
import { authComponent, createAuth } from "./auth"
import { parseRole, roleValidator, type Role } from "./validators"
import { MUTATION_REGISTRY } from "./_registry"

// Read-only user listing pages through the raw `betterAuth` component
// adapter (`components.betterAuth.adapter.findMany`), not through
// `auth.api.listUsers` — that endpoint requires a real session
// (`use: [adminMiddleware]` in better-auth's `routes.mjs`, verified against
// the installed `better-auth@1.6.17`) and a permission check, neither of
// which buys anything extra here: reading never puts the single-owner
// invariant at risk, and `requireRole` below already gates who may call this
// query at all. A single page of this size comfortably covers every
// realistic tenant for this project; looping keeps it correct rather than
// silently truncated if that ever stops being true.
const LIST_PAGE_SIZE = 200

// Les comptes portant un rôle donné, page par page — la primitive que
// `countUsersWithRole` (ci-dessous) et `leads.staffRecipients` partagent.
// Exportée plutôt que recopiée : le rôle vit sur l'utilisateur Better Auth
// (invariant 4), et une deuxième façon d'interroger la table `user` du
// composant serait une deuxième chose à corriger le jour où l'adaptateur
// change. `banned`/`banExpires` remontent avec le reste parce qu'un compte
// banni n'est plus un destinataire (voir `leads.staffRecipients`) : les
// omettre ici obligerait l'appelant à refaire une requête pour les obtenir.
export type StaffUser = {
  id: string
  email: string
  banned: boolean | null
  banExpires: number | null
}

export async function listUsersWithRole(
  ctx: QueryCtx | MutationCtx,
  role: Role,
): Promise<StaffUser[]> {
  let cursor: string | null = null
  const users: StaffUser[] = []
  for (;;) {
    const page: PaginationResult<GenericDocument> = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: "user" as const,
        where: [{ field: "role", operator: "eq" as const, value: role }],
        paginationOpts: { numItems: LIST_PAGE_SIZE, cursor },
      },
    )
    for (const doc of page.page) {
      users.push({
        id: String(doc._id),
        email: String(doc.email),
        banned: typeof doc.banned === "boolean" ? doc.banned : null,
        banExpires: typeof doc.banExpires === "number" ? doc.banExpires : null,
      })
    }
    if (page.isDone) return users
    cursor = page.continueCursor
  }
}

async function countUsersWithRole(ctx: QueryCtx | MutationCtx, role: Role): Promise<number> {
  return (await listUsersWithRole(ctx, role)).length
}

// `assertOwnerInvariant` throws a plain `OwnerInvariantError` with a
// `"CODE: message"`-shaped text (see `lib/ownerGuard.ts`) — a pure module
// that stays free of any Convex/HTTP-specific error type on purpose (it's
// shared with `auth.ts`'s `databaseHooks`, which translates it into an
// `APIError` instead; see `guardOwnerInvariant` there). This is the
// equivalent translation for this module: a typed `ConvexError({code})` the
// admin UI can branch on, exactly as the task brief asks for — "not
// redundant with the hooks: they're the infrangible barrier, this call
// surfaces a typed error the UI can render instead of an opaque failure."
function throwTypedOwnerInvariantError(err: unknown): never {
  if (err instanceof OwnerInvariantError) {
    const code = err.message.split(":")[0]?.trim() || "FORBIDDEN"
    throw new ConvexError({ code })
  }
  throw err
}

// Explicit field list (not a spread), same discipline as `invitations.list`:
// only what the screen needs ever leaves this query. `role` is
// `parseRole(...)`-checked rather than cast — a row this project's own
// write paths could never produce (an unclassifiable role) must render as
// visibly unclassifiable to the UI, never silently coerced to a default
// role that would then look like a real, actionable account.
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin"])

    const profiles = await ctx.db.query("profiles").collect()
    const byAuthId = new Map(profiles.map((p) => [p.authUserId, p]))

    const users: { id: string; email: string; role: Role | null; displayName: string }[] = []
    let cursor: string | null = null
    for (;;) {
      const page: PaginationResult<GenericDocument> = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: "user" as const,
          sortBy: { field: "email", direction: "asc" as const },
          paginationOpts: { numItems: LIST_PAGE_SIZE, cursor },
        },
      )
      for (const doc of page.page) {
        const id = String(doc._id)
        const email = String(doc.email)
        users.push({
          id,
          email,
          role: parseRole(doc.role),
          displayName: byAuthId.get(id)?.displayName ?? email,
        })
      }
      if (page.isDone) break
      cursor = page.continueCursor
    }
    return users
  },
})

// `assertOwnerInvariant` runs here **in addition to** `databaseHooks.user
// .update.before` (Task 6, wired in `auth.ts`) — not redundant, per the
// task brief: the hooks are the infrangible barrier (they run no matter how
// a write reaches better-auth's internal adapter, including a direct
// `/admin/set-role` call this Convex mutation never sees), this call is
// what turns a refusal into a typed `ConvexError` this screen can render
// instead of an opaque 500.
//
// The actual write goes through `auth.api.setRole`, not a raw
// `components.betterAuth.adapter.updateOne` call: the adapter's `updateOne`
// is a bare Convex mutation with no better-auth dispatch behind it at all —
// it would silently skip both better-auth's own RBAC permission check and
// `databaseHooks.user.update.before`, the exact barrier this mutation is
// supposed to be defense-in-depth *for*. `auth.api.setRole` runs the real
// `/admin/set-role` endpoint (verified against `better-auth@1.6.17`'s
// `routes.mjs`), which requires a genuine session — `use: [adminMiddleware]`
// throws UNAUTHORIZED outright without one — so `authComponent.getAuth`
// forwards the *caller's own* session (the owner/admin invoking this
// mutation) as a bearer header, the officially documented way to call a
// Better Auth API method from inside a Convex function.
export const setRole = mutation({
  args: { userId: v.string(), role: roleValidator },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["owner", "admin"])

    const target = await authComponent.getAnyUserById(ctx, args.userId)
    if (!target) throw new ConvexError({ code: "NOT_FOUND" })

    // I1 (Lot 1 final review): spec §5 gives `admin` authority to
    // invite/edit `editor` only — never another `admin` — reserving
    // everything else, `admin` included, to `owner`.
    // `assertOwnerInvariant` below only ever guards the *owner* role, so
    // admin-on-admin sailed through every one of its branches: a role
    // -table rule, not a single-owner one, so it's enforced here rather
    // than folded into that guard. An `admin` actor may only touch a
    // target that is *currently* `editor`, and may only ever set it back
    // to `editor` — a real role change (promote to `admin`, or act on an
    // existing `admin`) is refused outright, before the owner-invariant
    // check below even runs.
    if (actor.role === "admin" && (parseRole(target.role) !== "editor" || args.role !== "editor")) {
      throw new ConvexError({ code: "FORBIDDEN" })
    }

    const ownerCount = await countUsersWithRole(ctx, "owner")
    try {
      assertOwnerInvariant({
        operation: "update",
        actorId: actor._id,
        actorRole: actor.role,
        targetId: args.userId,
        targetRole: target.role,
        nextRole: args.role,
        ownerCount,
      })
    } catch (err) {
      throwTypedOwnerInvariantError(err)
    }

    const { auth, headers } = await authComponent.getAuth(createAuth, ctx)
    await auth.api.setRole({ body: { userId: args.userId, role: args.role }, headers })
  },
})

// Same shape as `setRole` above: our own `assertOwnerInvariant` pre-check
// for a typed error, then the real `/admin/remove-user` endpoint (via
// `auth.api.removeUser`) for the actual deletion — `databaseHooks.user
// .delete.before` is what makes this safe even if the pre-check here were
// ever wrong or bypassed.
//
// The self-removal refusal is ours, not just better-auth's own
// `YOU_CANNOT_REMOVE_YOURSELF`: without it, an admin removing themselves
// would sail past `assertOwnerInvariant` (nothing owner-related about an
// admin deleting their own non-owner row) and only be caught by
// `auth.api.removeUser`, whose `APIError` never reaches the UI as a typed
// `ConvexError` the way `throwTypedOwnerInvariantError` does.
export const remove = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["owner", "admin"])

    if (args.userId === actor._id) throw new ConvexError({ code: "CANNOT_REMOVE_SELF" })

    const target = await authComponent.getAnyUserById(ctx, args.userId)
    if (!target) throw new ConvexError({ code: "NOT_FOUND" })

    // I1 (Lot 1 final review): same rule as `setRole` above — an `admin`
    // actor may only remove a target that is currently `editor`. See that
    // mutation's own comment for why this lives here rather than in
    // `assertOwnerInvariant`.
    if (actor.role === "admin" && parseRole(target.role) !== "editor") {
      throw new ConvexError({ code: "FORBIDDEN" })
    }

    const ownerCount = await countUsersWithRole(ctx, "owner")
    try {
      assertOwnerInvariant({
        operation: "delete",
        actorId: actor._id,
        actorRole: actor.role,
        targetId: args.userId,
        targetRole: target.role,
        nextRole: undefined,
        ownerCount,
      })
    } catch (err) {
      throwTypedOwnerInvariantError(err)
    }

    const { auth, headers } = await authComponent.getAuth(createAuth, ctx)
    await auth.api.removeUser({ body: { userId: args.userId }, headers })
  },
})

// Required by `_registry.test.ts`'s exhaustiveness check, and exercised for
// real by `lib/authz.test.ts`'s permission matrix (a genuine session per
// role, not a bare identity — see that file's header). `list` (a query) is
// intentionally absent, same convention as `invitations.list`/
// `profiles.me`: the registry only ever tracks mutations.
MUTATION_REGISTRY.push(
  {
    name: "users.setRole",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const target = await t.run((ctx: any) =>
        createAuth(ctx).api.createUser({
          body: {
            email: `registry-setrole-target-${Date.now()}-${Math.random()}@example.com`,
            password: "correct horse battery staple registry setrole",
            name: "Registry SetRole Target",
            role: "editor",
          },
        }),
      )
      const targetId = (target as { user: { id: string } }).user.id
      return t.mutation(api.users.setRole, { userId: targetId, role: "editor" })
    },
  },
  {
    name: "users.remove",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const target = await t.run((ctx: any) =>
        createAuth(ctx).api.createUser({
          body: {
            email: `registry-remove-target-${Date.now()}-${Math.random()}@example.com`,
            password: "correct horse battery staple registry remove",
            name: "Registry Remove Target",
            role: "editor",
          },
        }),
      )
      const targetId = (target as { user: { id: string } }).user.id
      return t.mutation(api.users.remove, { userId: targetId })
    },
  },
)

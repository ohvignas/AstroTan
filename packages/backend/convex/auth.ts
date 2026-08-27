import { betterAuth, type BetterAuthOptions } from "better-auth/minimal"
import { admin } from "better-auth/plugins"
import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements } from "better-auth/plugins/admin/access"
import { convex } from "@convex-dev/better-auth/plugins"
import { createClient, type GenericCtx } from "@convex-dev/better-auth"
import { components } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import authSchema from "./betterAuth/schema"
import authConfig from "./auth.config"
import { parseRole } from "./lib/authz"
import { assertOwnerInvariant } from "./lib/ownerGuard"
import type { Role } from "./validators"

export const authComponent = createClient<DataModel, typeof authSchema>(
  components.betterAuth,
  { local: { schema: authSchema } },
)

// `defaultStatements` (from better-auth@1.6.17's admin plugin):
//   user: ["create", "list", "set-role", "ban", "impersonate",
//          "impersonate-admins", "delete", "set-password", "set-email",
//          "get", "update"]
//   session: ["list", "revoke", "delete"]
const ac = createAccessControl(defaultStatements)

// `impersonate` (and its `impersonate-admins` variant) is withheld from
// every role, owner included: a CMS back-office has no legitimate need to
// mint a session as another user, and granting it to any admin role would
// let that admin become the owner in all but name.
const ownerRole = ac.newRole({
  user: [
    "create",
    "list",
    "set-role",
    "ban",
    "delete",
    "set-password",
    "set-email",
    "get",
    "update",
  ],
  session: ["list", "revoke", "delete"],
})

// `admin` gets user list/create/set-role/ban/get/update/delete and full
// session management — Task 10's user-management screen needs to list,
// create, edit and remove users. Withheld: `impersonate`/
// `impersonate-admins` (nobody gets these, see ownerRole above) and
// `set-password`, which stays owner-only — it is the only account-recovery
// path until password reset by email exists, and letting an admin take
// over an owner's account would hollow out the single-owner invariant.
// Granting `user:delete` here is safe, not a loosening: plugin permissions
// gate whether the endpoint runs at all, and Task 6's databaseHooks guard
// independently prevents anyone — including an admin — from touching an
// owner. Two separate barriers doing two separate jobs.
const adminRole = ac.newRole({
  user: ["list", "create", "set-role", "ban", "get", "update", "delete"],
  session: ["list", "revoke", "delete"],
})

const editorRole = ac.newRole({
  user: [],
  session: [],
})

// Reads `secret`/`baseURL` plainly, with no guard: `createApi` (the
// component-side adapter, see betterAuth/adapter.ts) calls this at module
// load inside the betterAuth component's own isolated environment, which
// never sees the app deployment's env vars. The adapter only needs the
// *shape* of the options — schema and plugin list — never the secret, so
// it must tolerate an absent one. The guard lives in `createAuth` below,
// the actual auth server, mounted in http.ts on the app side where the
// vars do exist and where a missing secret would otherwise silently fall
// back to a publicly-known default constant.
export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.SITE_URL,
    database: authComponent.adapter(ctx), // requis — omis, rien ne persiste
    emailAndPassword: { enabled: true, disableSignUp: true },
    plugins: [
      convex({ authConfig }),
      admin({
        ac,
        roles: { owner: ownerRole, admin: adminRole, editor: editorRole },
        adminRoles: ["owner", "admin"],
        defaultRole: "editor",
      }),
    ],
    // Enforces the single-owner invariant (see `lib/ownerGuard.ts`) at the
    // one layer every write to the `user` table traverses. The admin()
    // plugin exposes its own HTTP endpoints (`/admin/set-role`,
    // `/admin/update-user`, `/admin/ban-user`, `/admin/remove-user`, …)
    // that write directly through better-auth's internal adapter — none of
    // them go through a Convex mutation of ours, so a guard placed in
    // application code would be trivially bypassable. `databaseHooks` runs
    // inside better-auth's own `updateWithHooks`/`deleteWithHooks`
    // (`node_modules/better-auth/dist/db/with-hooks.mjs`), which every one
    // of those endpoints calls via `ctx.context.internalAdapter`, so this
    // is the one choke point that can't be routed around.
    //
    // Signature verified against the installed better-auth@1.6.17 (not
    // written from memory, per the task's instruction):
    // `@better-auth/core`'s `src/types/init-options.ts` declares
    // `user.update.before?: (user: Partial<User> & Record<string, unknown>,
    // context: GenericEndpointContext | null) => Promise<boolean | void |
    // { data: … }>` and `user.delete.before?: (user: User & Record<string,
    // unknown>, context: GenericEndpointContext | null) => Promise<boolean
    // | void>`. Two details only the *implementation*
    // (`dist/db/with-hooks.mjs`) reveals, and that the type alone doesn't:
    //   - `update.before`'s first argument is the raw **update delta**
    //     (e.g. `{ role: "owner" }`), never the full row and never the
    //     target id — `updateWithHooks(data, where, model)` passes `data`
    //     straight through, `where` never reaches the hook. The target id
    //     has to come from `context.body.userId` (every admin route that
    //     calls `internalAdapter.updateUser(userId, …)` puts it there)
    //     instead, with a session-id fallback for self-service updates
    //     that don't carry a `userId` body field.
    //   - `delete.before`, unlike `update.before`, DOES receive the full
    //     entity: `deleteWithHooks` fetches it via `findMany` before
    //     calling the hook specifically so `delete.before` hooks can see
    //     the row being removed.
    // Coexistence with the admin() plugin's own `databaseHooks.user.create
    // .before` (which applies `defaultRole`) verified in
    // `dist/context/helpers.mjs`'s `runPluginInit`: each plugin's `init()`
    // result can return `{ options: { databaseHooks } }`, and every one
    // found is pushed onto a `dbHooks` array tagged `source:
    // "plugin:<id>"`; *after* every plugin has run, `options.databaseHooks`
    // (ours, i.e. what's written here) is pushed last, tagged `source:
    // "user"`. `db/with-hooks.mjs`'s `updateWithHooks`/`deleteWithHooks`
    // then iterate that whole array in order — plugin hooks first, ours
    // last — so this is additive, never a replacement of admin()'s own
    // hook. In practice there's no ordering interaction to worry about
    // either way: admin() only hooks `create`, this only hooks
    // `update`/`delete`.
    //
    // `context` is typed `GenericEndpointContext | null` and its shape
    // isn't precise enough to typecheck property access against (the
    // admin-plugin fields — `body.userId`, `context.session`,
    // `context.internalAdapter` — aren't part of the base `User`/context
    // types), so this reads through a narrow local shape instead of `any`
    // scattered through the body.
    databaseHooks: {
      user: {
        update: {
          before: async (data, context) => {
            const ctx = context as OwnerHookEndpointContext | null
            const internalAdapter = ctx?.context?.internalAdapter
            // Self-service updates (e.g. a user editing their own name)
            // don't carry `userId` in the body — the session's own id is
            // the target in that case.
            const targetId = ctx?.body?.userId ?? ctx?.context?.session?.user?.id
            if (typeof targetId !== "string" || !internalAdapter) return

            const targetUser = await internalAdapter.findUserById(targetId)
            const targetRole = parseRole(targetUser?.role) ?? "editor"

            const rawNextRole = (data as Record<string, unknown>).role
            const nextRole: Role | null =
              rawNextRole === undefined
                ? targetRole // role isn't part of this update: unchanged
                : parseRole(Array.isArray(rawNextRole) ? rawNextRole.join(",") : rawNextRole)

            assertOwnerInvariant({
              // Missing session -> `""`, which can never equal a real id,
              // so an unidentifiable actor fails closed against an owner
              // target (Check 1) exactly like a known-wrong actor would.
              actorId: ctx?.context?.session?.user?.id ?? "",
              actorRole: parseRole(ctx?.context?.session?.user?.role) ?? "editor",
              targetId,
              targetRole,
              nextRole,
              ownerCount: await countOwners(internalAdapter, targetRole),
            })
          },
        },
        delete: {
          before: async (user, context) => {
            const ctx = context as OwnerHookEndpointContext | null
            const target = user as { id?: string; role?: string | null }
            if (typeof target.id !== "string") return

            const targetRole = parseRole(target.role) ?? "editor"
            const internalAdapter = ctx?.context?.internalAdapter

            assertOwnerInvariant({
              actorId: ctx?.context?.session?.user?.id ?? "",
              actorRole: parseRole(ctx?.context?.session?.user?.role) ?? "editor",
              targetId: target.id,
              targetRole,
              nextRole: null, // suppression
              ownerCount: internalAdapter ? await countOwners(internalAdapter, targetRole) : 0,
            })
          },
        },
      },
    },
  }) satisfies BetterAuthOptions

// Narrow shape for the pieces of `GenericEndpointContext` the hooks above
// actually read. `body`/`context.session`/`context.internalAdapter` are
// all present at runtime (verified empirically — see
// `auth.ownerInvariant.test.ts`) but aren't part of the statically-typed
// `GenericEndpointContext`, which is generic over the endpoint and doesn't
// know about admin-plugin fields.
type OwnerHookEndpointContext = {
  body?: { userId?: string }
  context?: {
    session?: { user?: { id?: string; role?: string | null } } | null
    internalAdapter?: {
      findUserById: (id: string) => Promise<{ id: string; role?: string | null } | null>
      countTotalUsers: (
        where?: { field: string; operator?: string; value: unknown }[],
      ) => Promise<number>
    }
  }
}

// `ownerCount` only ever gates a decision when the *target* is an owner
// (see `assertOwnerInvariant`'s third check) — skip the extra round trip
// on every other write, which is the overwhelming majority of calls
// through this hook.
async function countOwners(
  internalAdapter: NonNullable<OwnerHookEndpointContext["context"]>["internalAdapter"],
  targetRole: Role,
): Promise<number> {
  if (targetRole !== "owner" || !internalAdapter) return 0
  return internalAdapter.countTotalUsers([{ field: "role", operator: "eq", value: "owner" }])
}

// better-auth's own publicly-known fallback secret (verified against
// better-auth@1.6.17's dist/utils/constants.mjs: `DEFAULT_SECRET`). A
// truthiness check on `options.secret` alone would pass if someone set
// BETTER_AUTH_SECRET to this exact value, or to a short/low-entropy string
// — better-auth only warns in both cases, it never throws outside
// NODE_ENV === "production". Checked explicitly below so misconfiguration
// fails loudly in every environment, not just production.
const DEFAULT_BETTER_AUTH_SECRET = "better-auth-secret-12345678901234567890"

// `requireSecret` defaults to true for every request-serving instance
// (convex/http.ts calls `createAuth` unchanged, so it always gets the
// default). The one exception is convex/betterAuth/auth.ts, the schema
// generator's introspection-only shim: it is never reachable as a Convex
// function and never serves a request, so demanding a deployment secret
// from it buys no security and only breaks component analysis at deploy
// time (Convex components have an isolated environment — see auth.ts's
// git history for the failure this caused). The real invariant is "no
// auth instance that serves HTTP requests may run on the library's
// fallback secret," not "every call site must have a secret" — this flag
// keeps that invariant precise instead of over-applying it.
export const createAuth = (
  ctx: GenericCtx<DataModel>,
  { requireSecret = true }: { requireSecret?: boolean } = {},
) => {
  const options = createAuthOptions(ctx)

  if (requireSecret) {
    // Required — without an explicit secret, better-auth falls back to a
    // publicly-known default constant outside NODE_ENV === "production",
    // and this secret signs cookies and derives verification/state
    // tokens.
    if (!options.secret) {
      throw new Error("BETTER_AUTH_SECRET is not set on this Convex deployment")
    }
    if (options.secret === DEFAULT_BETTER_AUTH_SECRET) {
      throw new Error(
        "BETTER_AUTH_SECRET is set to Better Auth's public default — generate a real one with: openssl rand -base64 32",
      )
    }
    if (options.secret.length < 32) {
      throw new Error("BETTER_AUTH_SECRET must be at least 32 characters")
    }

    // Required — unset, better-auth derives the origin per-request from
    // request headers, so `trustedOrigins` becomes whatever host the
    // incoming request claims.
    if (!options.baseURL) {
      throw new Error("SITE_URL is not set on this Convex deployment")
    }
  }

  return betterAuth(options)
}

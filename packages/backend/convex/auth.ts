import { betterAuth, type BetterAuthOptions } from "better-auth/minimal"
import { admin } from "better-auth/plugins"
import { APIError } from "better-auth/api"
import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements } from "better-auth/plugins/admin/access"
import { convex } from "@convex-dev/better-auth/plugins"
import { createClient, type GenericCtx } from "@convex-dev/better-auth"
import { components } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import authSchema from "./betterAuth/schema"
import authConfig from "./auth.config"
import { parseRole } from "./validators"
import { assertOwnerInvariant, OwnerInvariantError } from "./lib/ownerGuard"

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
    // `/admin/create-user`, `/admin/update-user`, `/admin/ban-user`,
    // `/admin/remove-user`, …) that write directly through better-auth's
    // internal adapter — none of them go through a Convex mutation of
    // ours, so a guard placed in application code would be trivially
    // bypassable. `databaseHooks` runs inside better-auth's own
    // `createWithHooks`/`updateWithHooks`/`deleteWithHooks`
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
    //   - `create.before` sees the *resolved* role, not the caller's raw
    //     input: `/admin/create-user`'s own handler already computes
    //     `role: requestedRole ?? opts.defaultRole` before ever calling
    //     `internalAdapter.createUser(...)`, so by the time any
    //     `create.before` hook runs, `data.role` is whatever the row will
    //     actually be created with.
    // Coexistence with the admin() plugin's own `databaseHooks.user.create
    // .before` (which applies `defaultRole`) verified in
    // `dist/context/helpers.mjs`'s `runPluginInit`: each plugin's `init()`
    // result can return `{ options: { databaseHooks } }`, and every one
    // found is pushed onto a `dbHooks` array tagged `source:
    // "plugin:<id>"`; *after* every plugin has run, `options.databaseHooks`
    // (ours, i.e. what's written here) is pushed last, tagged `source:
    // "user"`. `db/with-hooks.mjs`'s `createWithHooks`/`updateWithHooks`/
    // `deleteWithHooks` then iterate that whole array in order — plugin
    // hooks first, ours last — so this is additive, never a replacement of
    // admin()'s own hook.
    //
    // `context` is typed `GenericEndpointContext | null` and its shape
    // isn't precise enough to typecheck property access against (the
    // admin-plugin fields — `body.userId`, `context.session`,
    // `context.internalAdapter` — aren't part of the base `User`/context
    // types), so this reads through a narrow local shape instead of `any`
    // scattered through the body.
    databaseHooks: {
      user: {
        // C2: `/admin/create-user` honours an explicit `role` in its body
        // as long as the caller holds the `set-role` permission — which
        // `adminRole` above does — and performs no owner check of its
        // own. Without this, an authenticated `admin` (not `owner`) could
        // call it directly with `role: "owner"` and mint a second owner
        // outright, entirely bypassing the `update`/`delete` guards below
        // (they only ever see a row that already exists).
        create: {
          before: guardOwnerInvariant(async (data, context) => {
            const raw = (data as Record<string, unknown>).role
            if (raw === undefined) return
            // Mirrors better-auth's own `parseRoles`: an array role is
            // joined into one comma-separated string before it ever
            // reaches a hook, so a plain string is the only shape to
            // expect here — checked defensively all the same.
            const parts = (Array.isArray(raw) ? raw.join(",") : String(raw))
              .split(",")
              .map((r) => parseRole(r.trim()))
            if (!parts.includes("owner")) return

            const internalAdapter = (context as OwnerHookEndpointContext | null)?.context
              ?.internalAdapter
            if (!internalAdapter) {
              throw new OwnerInvariantError(
                "CANNOT_VERIFY_OWNER_INVARIANT: création avec rôle owner sans contexte suffisant pour vérifier l'absence d'un owner existant",
              )
            }

            // `owners === 0` *is* the bootstrap condition — checking it
            // directly is safer than trying to infer "this is the very
            // first admin setup" from *how* the caller authenticated
            // (e.g. "no session at all"): a legitimate bootstrap script
            // and an attacker replaying a stolen admin session can look
            // identical under that heuristic. Exactly one owner, ever,
            // regardless of who's asking.
            const owners = await internalAdapter.countTotalUsers([
              { field: "role", operator: "eq", value: "owner" },
            ])
            if (owners > 0) {
              throw new OwnerInvariantError(
                "OWNER_ALREADY_EXISTS: un seul owner est autorisé, la création est refusée",
              )
            }
          }),
        },
        update: {
          before: guardOwnerInvariant(async (data, context) => {
            const ctx = context as OwnerHookEndpointContext | null
            const internalAdapter = ctx?.context?.internalAdapter
            // Self-service updates (e.g. a user editing their own name)
            // don't carry `userId` in the body — the session's own id is
            // the target in that case.
            const targetId = ctx?.body?.userId ?? ctx?.context?.session?.user?.id
            const rawNextRole = (data as Record<string, unknown>).role

            if (typeof targetId !== "string" || !internalAdapter) {
              // M1: fail *closed*, not open. An update that touches
              // `role` with no identifiable target and/or no adapter to
              // check against must never be let through unchecked — role
              // is the one field this whole task exists to guard. Updates
              // that don't touch `role` at all (the overwhelming
              // majority — name/image/etc edits) aren't this invariant's
              // concern and are let through unexamined, same as before.
              if (rawNextRole !== undefined) {
                throw new OwnerInvariantError(
                  "CANNOT_VERIFY_OWNER_INVARIANT: changement de rôle sans contexte suffisant pour vérifier l'invariant",
                )
              }
              return
            }

            const targetUser = await internalAdapter.findUserById(targetId)
            if (!targetUser) return // NOT_FOUND is the endpoint's own concern

            assertOwnerInvariant({
              operation: "update",
              // Missing session -> `""`, which can never equal a real id,
              // so an unidentifiable actor fails closed against an owner
              // target (Check 1) exactly like a known-wrong actor would.
              actorId: ctx?.context?.session?.user?.id ?? "",
              actorRole: ctx?.context?.session?.user?.role,
              targetId,
              targetRole: targetUser.role,
              nextRole: rawNextRole === undefined ? targetUser.role : rawNextRole,
              // M2/C1: computed unconditionally, not gated on a local
              // "does this look like an owner?" pre-check. A gate here
              // has to reach the same role classification
              // `assertOwnerInvariant` reaches internally, and keeping
              // two independent classifications in sync is exactly how
              // the C1 bug happened — a comma-joined multi-role value
              // parsed to `null` at the gate (so the count was skipped
              // *and* the row was treated as non-owner) while
              // better-auth's own `hasPermission` still granted owner
              // permissions on the strength of the same string. This
              // endpoint isn't high-QPS; the extra query is worth not
              // having a second place to get the classification wrong.
              ownerCount: await internalAdapter.countTotalUsers([
                { field: "role", operator: "eq", value: "owner" },
              ]),
            })
          }),
        },
        delete: {
          before: guardOwnerInvariant(async (user, context) => {
            const ctx = context as OwnerHookEndpointContext | null
            const target = user as { id?: string; role?: string | null }
            const internalAdapter = ctx?.context?.internalAdapter

            if (typeof target.id !== "string" || !internalAdapter) {
              // Same fail-closed posture as the update path (M1):
              // better-auth's own `deleteWithHooks` only calls this hook
              // once it has already fetched the row being removed (see
              // the signature note above), so a missing id/adapter here
              // means something is wrong with the call, not that there's
              // nothing to check.
              throw new OwnerInvariantError(
                "CANNOT_VERIFY_OWNER_INVARIANT: suppression sans contexte suffisant pour vérifier l'invariant",
              )
            }

            assertOwnerInvariant({
              operation: "delete",
              actorId: ctx?.context?.session?.user?.id ?? "",
              actorRole: ctx?.context?.session?.user?.role,
              targetId: target.id,
              targetRole: target.role,
              nextRole: undefined, // ignored for delete — see ownerGuard.ts
              ownerCount: await internalAdapter.countTotalUsers([
                { field: "role", operator: "eq", value: "owner" },
              ]),
            })
          }),
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

// I2: translates the pure layer's `OwnerInvariantError` into a real
// `APIError` at the one place better-auth's dispatcher actually inspects
// for one (`isAPIError` in `dist/api/dispatch.mjs`). Left as a plain
// thrown `Error`, it propagates past that check and the router answers a
// bare 500 with an **empty** body — indistinguishable from an unrelated
// crash, and useless to an admin UI trying to explain the refusal to an
// operator. `ownerGuard.ts` itself stays HTTP-free; only this wiring layer
// knows about `APIError`.
function guardOwnerInvariant<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>,
): (...args: Args) => Promise<void> {
  return async (...args) => {
    try {
      await fn(...args)
    } catch (err) {
      if (err instanceof OwnerInvariantError) {
        throw APIError.from("FORBIDDEN", { code: "OWNER_INVARIANT", message: err.message })
      }
      throw err
    }
  }
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

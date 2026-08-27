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

// `set-password` stays owner-only: it is the only account-recovery path
// until password reset by email exists, and letting an admin take over an
// owner's account would hollow out the single-owner invariant.
const adminRole = ac.newRole({
  user: ["list", "create", "set-role", "ban"],
  session: ["revoke"],
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
  }) satisfies BetterAuthOptions

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

    // Required — unset, better-auth derives the origin per-request from
    // request headers, so `trustedOrigins` becomes whatever host the
    // incoming request claims.
    if (!options.baseURL) {
      throw new Error("SITE_URL is not set on this Convex deployment")
    }
  }

  return betterAuth(options)
}

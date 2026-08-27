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

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  // Required — without an explicit secret, better-auth falls back to a
  // publicly-known default constant outside NODE_ENV === "production", and
  // this secret signs cookies and derives verification/state tokens.
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is not set on this Convex deployment")
  }

  // Required — unset, better-auth derives the origin per-request from
  // request headers, so `trustedOrigins` becomes whatever host the
  // incoming request claims.
  const baseURL = process.env.SITE_URL
  if (!baseURL) {
    throw new Error("SITE_URL is not set on this Convex deployment")
  }

  return {
    secret,
    baseURL,
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
  } satisfies BetterAuthOptions
}

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx))

import { betterAuth, type BetterAuthOptions } from "better-auth/minimal"
import { admin } from "better-auth/plugins"
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

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    baseURL: process.env.SITE_URL,
    database: authComponent.adapter(ctx), // requis — omis, rien ne persiste
    emailAndPassword: { enabled: true, disableSignUp: true },
    plugins: [convex({ authConfig }), admin()],
  }) satisfies BetterAuthOptions

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx))

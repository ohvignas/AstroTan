import { ConvexError, v } from "convex/values"
import { action, internalMutation, query } from "./_generated/server"
import { components, internal } from "./_generated/api"
import { authComponent, createAuth } from "./auth"
import { demoSandboxActif, estCompteDemo } from "./lib/demoSandbox"
import { assertDemoEnterBudget } from "./lib/demoEnterRateLimit"
import { deriverOrigines } from "./lib/origines"
import { assertSharedSecret } from "./lib/sharedSecret"

function credentialsPrets(env: Record<string, string | undefined>): boolean {
  return Boolean(
    env.DEMO_ENTER_SECRET &&
      env.DEMO_ACCOUNT_EMAIL &&
      env.DEMO_ACCOUNT_PASSWORD &&
      env.DEMO_OPENROUTER_MODEL,
  )
}

function comptePret(env: Record<string, string | undefined>): boolean {
  return Boolean(env.DEMO_ACCOUNT_EMAIL && env.DEMO_ACCOUNT_PASSWORD)
}

async function assertDemoEnterSecret(
  provided: string,
  expected: string | undefined,
): Promise<void> {
  try {
    await assertSharedSecret(provided, expected)
  } catch (error) {
    if (error instanceof ConvexError) {
      const code = (error.data as { code?: string }).code
      if (code === "NOT_CONFIGURED") {
        throw new ConvexError({ code: "DEMO_NOT_CONFIGURED" })
      }
      if (code === "FORBIDDEN") {
        throw new ConvexError({ code: "DEMO_FORBIDDEN" })
      }
    }
    throw error
  }
}

export const ouvert = query({
  args: {},
  handler: async (ctx) => {
    const env = process.env
    if (!demoSandboxActif(env)) return { actif: false, adminUrl: null }
    const origines = deriverOrigines((await ctx.db.query("settings").first())?.declaredDomain, env)
    return { actif: true, adminUrl: origines.admin }
  },
})

export const credentials = action({
  args: { secret: v.string(), ip: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const env = process.env
    if (!demoSandboxActif(env)) throw new ConvexError({ code: "DEMO_OFF" })
    if (!credentialsPrets(env)) throw new ConvexError({ code: "DEMO_NOT_CONFIGURED" })
    await assertDemoEnterSecret(args.secret, env.DEMO_ENTER_SECRET)
    await ctx.runMutation(internal.demo.assertEnterBudget, { ip: args.ip })
    return { email: env.DEMO_ACCOUNT_EMAIL, password: env.DEMO_ACCOUNT_PASSWORD }
  },
})

export const assertEnterBudget = internalMutation({
  args: { ip: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await assertDemoEnterBudget(ctx, args.ip)
  },
})

export const jeSuisDemo = query({
  args: {},
  handler: async (ctx) => {
    const env = process.env
    const authUser = await authComponent.safeGetAuthUser(ctx)
    if (!authUser) return false
    return estCompteDemo(authUser, env)
  },
})

export const seedSandbox = internalMutation({
  args: {},
  handler: async (ctx) => {
    const env = process.env
    if (!demoSandboxActif(env)) return { skipped: true }
    if (!comptePret(env)) throw new ConvexError({ code: "DEMO_NOT_CONFIGURED" })

    const email = env.DEMO_ACCOUNT_EMAIL!.trim().toLowerCase()
    const password = env.DEMO_ACCOUNT_PASSWORD!
    const existing = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user" as const,
      where: [{ field: "email" as const, operator: "eq" as const, value: email }],
    })
    if (existing) return { skipped: true }

    const auth = createAuth(ctx)
    await auth.api.createUser({
      body: { email, password, name: "Démo", role: "editor" },
    })
    return { skipped: false }
  },
})

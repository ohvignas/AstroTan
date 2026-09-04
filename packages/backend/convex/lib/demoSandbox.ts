import { ConvexError } from "convex/values"

export type DemoSandboxEnv = Record<string, string | undefined>

export function demoSandboxActif(env: Record<string, string | undefined>): boolean {
  return env.DEMO_SANDBOX === "true"
}

export function estCompteDemo(
  authUser: { email: string },
  env: Record<string, string | undefined>,
): boolean {
  if (!demoSandboxActif(env)) return false
  const demoEmail = env.DEMO_ACCOUNT_EMAIL
  if (!demoEmail) return false
  return (
    authUser.email.toLowerCase().trim() === demoEmail.toLowerCase().trim()
  )
}

export function exigerPasDemo(
  authUser: { email: string },
  env: Record<string, string | undefined>,
): void {
  if (estCompteDemo(authUser, env)) {
    throw new ConvexError({ code: "DEMO_FORBIDDEN" })
  }
}

export function modeleSandbox(
  _settings: { openRouterModel?: string | null },
  env: Record<string, string | undefined>,
): string | null {
  if (!demoSandboxActif(env)) return null
  const model = env.DEMO_OPENROUTER_MODEL?.trim()
  return model || null
}

export function modeleEffectif(
  settingsModel: string | null | undefined,
  env: Record<string, string | undefined>,
): string | null | undefined {
  if (!demoSandboxActif(env)) return settingsModel
  return modeleSandbox({}, env)
}

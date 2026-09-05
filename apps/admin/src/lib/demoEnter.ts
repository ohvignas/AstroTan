export function secretPresent(env: Record<string, string | undefined>): boolean {
  return Boolean(env.DEMO_ENTER_SECRET?.length)
}

export type Ouvert = { actif: boolean; adminUrl: string | null }

export function entrerDemo(input: {
  ouvert: Ouvert | null
  secretEnv: boolean
  rateLimited?: boolean
}): "404" | "429" | "ok" {
  if (!input.secretEnv) return "404"
  if (!input.ouvert || !input.ouvert.actif) return "404"
  if (input.rateLimited) return "429"
  return "ok"
}

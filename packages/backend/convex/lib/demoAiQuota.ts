import { HOUR, RateLimiter, type RateLimitConfig } from "@convex-dev/rate-limiter"
import { ConvexError } from "convex/values"
import { components } from "../_generated/api"
import type { MutationCtx } from "../_generated/server"

export const DEMO_AI_LIMIT_NAME = "demoAiByUser"

/**
 * Quinze générations IA par heure et par compte démo.
 *
 * `capacity` égale `rate` : pas de réserve accumulée pendant
 * l'inactivité. La clé est l'`_id` Better Auth, pas l'IP : un seul
 * seau pour ce compte, indépendant du quota d'entrée.
 */
export const DEMO_AI_LIMIT: RateLimitConfig = {
  kind: "token bucket",
  rate: 15,
  period: HOUR,
  capacity: 15,
}

const limiteur = new RateLimiter(components.rateLimiter, {
  [DEMO_AI_LIMIT_NAME]: DEMO_AI_LIMIT,
})

export async function assertDemoAiBudget(
  ctx: MutationCtx,
  userId: string,
): Promise<void> {
  const verdict = await limiteur.limit(ctx, DEMO_AI_LIMIT_NAME, { key: userId })
  if (!verdict.ok) {
    throw new ConvexError({ code: "DEMO_RATE_LIMITED", retryAfter: verdict.retryAfter })
  }
}

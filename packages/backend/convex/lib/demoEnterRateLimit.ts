import { HOUR, RateLimiter, type RateLimitConfig } from "@convex-dev/rate-limiter"
import { ConvexError } from "convex/values"
import { components } from "../_generated/api"
import type { MutationCtx } from "../_generated/server"
import { origineDeComptage } from "./originFingerprint"

export const DEMO_ENTER_LIMIT_NAME = "demoEnterByIp"

/**
 * Dix échanges de credentials par heure et par IP.
 *
 * `credentials` est une action publique sans session : le secret partagé
 * est la seule porte, et sans plafond une boucle brute-force resterait
 * gratuite. `capacity` égale `rate` : pas de réserve accumulée pendant
 * l'inactivité.
 */
export const DEMO_ENTER_LIMIT_CONFIG: RateLimitConfig = {
  kind: "token bucket",
  rate: 10,
  period: HOUR,
  capacity: 10,
}

const limiteur = new RateLimiter(components.rateLimiter, {
  [DEMO_ENTER_LIMIT_NAME]: DEMO_ENTER_LIMIT_CONFIG,
})

export async function assertDemoEnterBudget(
  ctx: MutationCtx,
  ip: string | undefined,
): Promise<void> {
  const verdict = await limiteur.limit(ctx, DEMO_ENTER_LIMIT_NAME, {
    key: origineDeComptage(ip),
  })
  if (!verdict.ok) {
    throw new ConvexError({ code: "DEMO_RATE_LIMITED", retryAfter: verdict.retryAfter })
  }
}

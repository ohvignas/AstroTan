import { HOUR, RateLimiter, type RateLimitConfig } from "@convex-dev/rate-limiter"
import { ConvexError } from "convex/values"
import { components } from "../_generated/api"
import type { MutationCtx } from "../_generated/server"

export const EMAIL_TEST_DEMO_LIMIT_NAME = "emailTestDemoByUser"
export const EMAIL_TEST_STAFF_LIMIT_NAME = "emailTestStaffByUser"

/**
 * Trois envois de test par heure pour le compte démo.
 *
 * L'essai produit doit rester possible, sans ouvrir un relais ouvert.
 * La clé est l'`_id` Better Auth : un seul seau par compte.
 */
export const EMAIL_TEST_DEMO_LIMIT: RateLimitConfig = {
  kind: "token bucket",
  rate: 3,
  period: HOUR,
  capacity: 3,
}

/**
 * Vingt envois de test par heure pour owner / admin / editor hors démo.
 *
 * Plus haut que le seau démo : un adoptant qui pose Resend doit pouvoir
 * retenter sans attendre une heure, sans pour autant spammer.
 */
export const EMAIL_TEST_STAFF_LIMIT: RateLimitConfig = {
  kind: "token bucket",
  rate: 20,
  period: HOUR,
  capacity: 20,
}

const limiteur = new RateLimiter(components.rateLimiter, {
  [EMAIL_TEST_DEMO_LIMIT_NAME]: EMAIL_TEST_DEMO_LIMIT,
  [EMAIL_TEST_STAFF_LIMIT_NAME]: EMAIL_TEST_STAFF_LIMIT,
})

export async function consommerQuotaEmailTest(
  ctx: MutationCtx,
  userId: string,
  seau: "demo" | "staff",
): Promise<void> {
  const nom = seau === "demo" ? EMAIL_TEST_DEMO_LIMIT_NAME : EMAIL_TEST_STAFF_LIMIT_NAME
  const verdict = await limiteur.limit(ctx, nom, { key: userId })
  if (!verdict.ok) {
    throw new ConvexError({ code: "RATE_LIMITED", retryAfter: verdict.retryAfter })
  }
}

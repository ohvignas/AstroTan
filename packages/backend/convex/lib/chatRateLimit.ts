import { HOUR, RateLimiter, type RateLimitConfig } from "@convex-dev/rate-limiter"
import { ConvexError } from "convex/values"
import { components } from "../_generated/api"
import type { MutationCtx } from "../_generated/server"
import { origineDeComptage } from "./originFingerprint"

export const CHAT_ORIGIN_LIMIT_NAME = "chatMessageByOrigin"

/**
 * Vingt messages par heure et par origine.
 *
 * Plus large que le formulaire : un échange réel tient plusieurs tours.
 * `capacity` égale `rate` : pas de réserve accumulée pendant l'inactivité.
 */
export const CHAT_ORIGIN_LIMIT_CONFIG: RateLimitConfig = {
  kind: "token bucket",
  rate: 20,
  period: HOUR,
  capacity: 20,
}

export const CHAT_EMAIL_LIMIT_NAME = "chatMessageByEmail"

/**
 * Trente messages par heure et par adresse.
 *
 * Un peu plus large que l'origine : une même personne peut écrire plus
 * souvent qu'un bureau entier derrière une NAT.
 */
export const CHAT_EMAIL_LIMIT_CONFIG: RateLimitConfig = {
  kind: "token bucket",
  rate: 30,
  period: HOUR,
  capacity: 30,
}

const limiteur = new RateLimiter(components.rateLimiter, {
  [CHAT_ORIGIN_LIMIT_NAME]: CHAT_ORIGIN_LIMIT_CONFIG,
  [CHAT_EMAIL_LIMIT_NAME]: CHAT_EMAIL_LIMIT_CONFIG,
})

export async function assertChatMessageBudget(
  ctx: MutationCtx,
  origin: string | undefined,
  email: string,
): Promise<void> {
  const parOrigine = await limiteur.limit(ctx, CHAT_ORIGIN_LIMIT_NAME, {
    key: origineDeComptage(origin),
  })
  if (!parOrigine.ok) {
    throw new ConvexError({ code: "RATE_LIMITED", retryAfter: parOrigine.retryAfter })
  }
  const parEmail = await limiteur.limit(ctx, CHAT_EMAIL_LIMIT_NAME, { key: email })
  if (!parEmail.ok) {
    throw new ConvexError({ code: "RATE_LIMITED", retryAfter: parEmail.retryAfter })
  }
}

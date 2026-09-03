import { HOUR, MINUTE, RateLimiter, type RateLimitConfig } from "@convex-dev/rate-limiter"
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

export const CHAT_START_ORIGIN_LIMIT_NAME = "chatStartByOrigin10m"

/**
 * Huit nouvelles conversations par dix minutes et par origine.
 *
 * Distinct du quota messages (send) et du quota formulaire (5/h) :
 * reset + renvoi légitime passe ; une rafale de `/start` s'arrête avant
 * d'épuiser l'heure. Seau neuf (`10m`) : l'ancien `chatStartByOrigin`
 * 20/h restait plein après un spam et bloquait le reset suivant.
 */
export const CHAT_START_ORIGIN_LIMIT_CONFIG: RateLimitConfig = {
  kind: "token bucket",
  rate: 8,
  period: 10 * MINUTE,
  capacity: 8,
}

export const CHAT_ATTACH_ORIGIN_LIMIT_NAME = "chatAttachEmailByOrigin"
export const CHAT_ATTACH_SESSION_LIMIT_NAME = "chatAttachEmailBySession"

/**
 * Six attaches par minute et par origine, et autant par session.
 *
 * Distinct du quota messages (send) et du formulaire (3–5/h) : poser
 * l'e-mail n'est pas un message, et un retry après une faute de frappe
 * ne doit pas afficher « Trop de messages ».
 */
export const CHAT_ATTACH_ORIGIN_LIMIT_CONFIG: RateLimitConfig = {
  kind: "token bucket",
  rate: 6,
  period: MINUTE,
  capacity: 6,
}

export const CHAT_ATTACH_SESSION_LIMIT_CONFIG: RateLimitConfig = {
  kind: "token bucket",
  rate: 6,
  period: MINUTE,
  capacity: 6,
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
  [CHAT_START_ORIGIN_LIMIT_NAME]: CHAT_START_ORIGIN_LIMIT_CONFIG,
  [CHAT_ATTACH_ORIGIN_LIMIT_NAME]: CHAT_ATTACH_ORIGIN_LIMIT_CONFIG,
  [CHAT_ATTACH_SESSION_LIMIT_NAME]: CHAT_ATTACH_SESSION_LIMIT_CONFIG,
})

export async function assertChatStartBudget(
  ctx: MutationCtx,
  origin: string | undefined,
): Promise<void> {
  const parOrigine = await limiteur.limit(ctx, CHAT_START_ORIGIN_LIMIT_NAME, {
    key: origineDeComptage(origin),
  })
  if (!parOrigine.ok) {
    throw new ConvexError({ code: "RATE_LIMITED", retryAfter: parOrigine.retryAfter })
  }
}

export async function assertChatAttachEmailBudget(
  ctx: MutationCtx,
  origin: string | undefined,
  sessionToken: string,
): Promise<void> {
  const parSession = await limiteur.limit(ctx, CHAT_ATTACH_SESSION_LIMIT_NAME, {
    key: sessionToken,
  })
  if (!parSession.ok) {
    throw new ConvexError({ code: "RATE_LIMITED", retryAfter: parSession.retryAfter })
  }
  const parOrigine = await limiteur.limit(ctx, CHAT_ATTACH_ORIGIN_LIMIT_NAME, {
    key: origineDeComptage(origin),
  })
  if (!parOrigine.ok) {
    throw new ConvexError({ code: "RATE_LIMITED", retryAfter: parOrigine.retryAfter })
  }
}

export async function assertChatMessageBudget(
  ctx: MutationCtx,
  origin: string | undefined,
  email?: string,
): Promise<void> {
  const parOrigine = await limiteur.limit(ctx, CHAT_ORIGIN_LIMIT_NAME, {
    key: origineDeComptage(origin),
  })
  if (!parOrigine.ok) {
    throw new ConvexError({ code: "RATE_LIMITED", retryAfter: parOrigine.retryAfter })
  }
  if (email === undefined || email.length === 0) return
  const parEmail = await limiteur.limit(ctx, CHAT_EMAIL_LIMIT_NAME, { key: email })
  if (!parEmail.ok) {
    throw new ConvexError({ code: "RATE_LIMITED", retryAfter: parEmail.retryAfter })
  }
}

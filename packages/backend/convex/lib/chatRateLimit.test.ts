import { describe, expect, test } from "vitest"
import { HOUR, MINUTE } from "@convex-dev/rate-limiter"
import {
  CHAT_ATTACH_ORIGIN_LIMIT_CONFIG,
  CHAT_ATTACH_ORIGIN_LIMIT_NAME,
  CHAT_ATTACH_SESSION_LIMIT_CONFIG,
  CHAT_ATTACH_SESSION_LIMIT_NAME,
  CHAT_EMAIL_LIMIT_NAME,
  CHAT_ORIGIN_LIMIT_CONFIG,
  CHAT_ORIGIN_LIMIT_NAME,
  CHAT_START_ORIGIN_LIMIT_CONFIG,
  CHAT_START_ORIGIN_LIMIT_NAME,
} from "./chatRateLimit"
import { LEAD_EMAIL_LIMIT_NAME, LEAD_ORIGIN_LIMIT_NAME } from "./leadRateLimit"

describe("quota start anonyme", () => {
  test("hors du seau messages, assez large pour reset+renvoi, assez serré pour une rafale", () => {
    expect(CHAT_START_ORIGIN_LIMIT_NAME).toBe("chatStartByOrigin10m")
    expect(CHAT_START_ORIGIN_LIMIT_NAME).not.toBe("chatStartByOrigin")
    expect(CHAT_START_ORIGIN_LIMIT_NAME).not.toBe("chatMessageByOrigin")
    expect(CHAT_START_ORIGIN_LIMIT_CONFIG.capacity).toBe(CHAT_START_ORIGIN_LIMIT_CONFIG.rate)
    expect(CHAT_START_ORIGIN_LIMIT_CONFIG.period).toBe(10 * MINUTE)
    expect(CHAT_START_ORIGIN_LIMIT_CONFIG.rate).toBeGreaterThanOrEqual(6)
    expect(CHAT_START_ORIGIN_LIMIT_CONFIG.rate).toBeLessThanOrEqual(10)
    expect(CHAT_START_ORIGIN_LIMIT_CONFIG.rate).toBeLessThan(CHAT_ORIGIN_LIMIT_CONFIG.rate)
  })
})

describe("quota attach email", () => {
  test("aucune réserve ne s'accumule", () => {
    expect(CHAT_ATTACH_ORIGIN_LIMIT_CONFIG.capacity).toBe(CHAT_ATTACH_ORIGIN_LIMIT_CONFIG.rate)
    expect(CHAT_ATTACH_SESSION_LIMIT_CONFIG.capacity).toBe(CHAT_ATTACH_SESSION_LIMIT_CONFIG.rate)
  })

  test("l'attache e-mail n'est ni le budget messages ni le formulaire", () => {
    expect(CHAT_ATTACH_ORIGIN_LIMIT_NAME).not.toBe(CHAT_ORIGIN_LIMIT_NAME)
    expect(CHAT_ATTACH_ORIGIN_LIMIT_NAME).not.toBe(CHAT_EMAIL_LIMIT_NAME)
    expect(CHAT_ATTACH_ORIGIN_LIMIT_NAME).not.toBe(LEAD_ORIGIN_LIMIT_NAME)
    expect(CHAT_ATTACH_ORIGIN_LIMIT_NAME).not.toBe(LEAD_EMAIL_LIMIT_NAME)
    expect(CHAT_ATTACH_SESSION_LIMIT_NAME).not.toBe(CHAT_ATTACH_ORIGIN_LIMIT_NAME)
    expect(CHAT_START_ORIGIN_LIMIT_NAME).not.toBe(LEAD_ORIGIN_LIMIT_NAME)
  })

  test("l'attache e-mail est généreuse à la minute, pas trois par heure", () => {
    expect(CHAT_ATTACH_ORIGIN_LIMIT_CONFIG.period).toBe(MINUTE)
    expect(CHAT_ATTACH_SESSION_LIMIT_CONFIG.period).toBe(MINUTE)
    expect(CHAT_ATTACH_ORIGIN_LIMIT_CONFIG.rate).toBeGreaterThanOrEqual(6)
    expect(CHAT_ATTACH_SESSION_LIMIT_CONFIG.rate).toBeGreaterThanOrEqual(6)
    expect(CHAT_ORIGIN_LIMIT_CONFIG.period).toBe(HOUR)
  })
})

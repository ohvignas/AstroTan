import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import { MAX_AGENT_TEASER } from "../content"
import {
  DEFAULT_AGENT_CHAT_COLOR,
  assertAgentChatColor,
  assertAgentTeaser,
  chatAccentForeground,
  resolveAgentChatColor,
  visibleChatTeaser,
} from "./agentChatAppearance"

test("un hex valide est normalisé en #rrggbb", () => {
  expect(assertAgentChatColor("#F60")).toBe("#ff6600")
  expect(assertAgentChatColor("  #f60f74  ")).toBe("#f60f74")
  expect(assertAgentChatColor("#171717")).toBe("#171717")
})

test("une chaîne vide efface la couleur (repli côté lecture)", () => {
  expect(assertAgentChatColor("")).toBe("")
  expect(assertAgentChatColor("   ")).toBe("")
})

test("un hex invalide lève INVALID_AGENT_CHAT_COLOR", () => {
  for (const value of ["red", "171717", "#12", "#12345", "#gg0000", "oklch(0.2 0 0)"]) {
    expect(() => assertAgentChatColor(value)).toThrow(ConvexError)
    try {
      assertAgentChatColor(value)
    } catch (error) {
      expect(error).toMatchObject({ data: { code: "INVALID_AGENT_CHAT_COLOR" } })
    }
  }
})

test("le teaser accepte la borne et refuse au-delà", () => {
  expect(assertAgentTeaser("x".repeat(MAX_AGENT_TEASER))).toHaveLength(MAX_AGENT_TEASER)
  expect(assertAgentTeaser("  Bonjour  ")).toBe("Bonjour")
  expect(assertAgentTeaser("   ")).toBe("")
  try {
    assertAgentTeaser("x".repeat(MAX_AGENT_TEASER + 1))
    expect.unreachable()
  } catch (error) {
    expect(error).toMatchObject({
      data: { code: "FIELD_TOO_LONG", field: "agentTeaser", max: MAX_AGENT_TEASER },
    })
  }
})

test("sans couleur saisie, le chrome reste le noir actuel", () => {
  expect(DEFAULT_AGENT_CHAT_COLOR).toBe("#171717")
  expect(resolveAgentChatColor(null)).toBe(DEFAULT_AGENT_CHAT_COLOR)
  expect(resolveAgentChatColor(undefined)).toBe(DEFAULT_AGENT_CHAT_COLOR)
  expect(resolveAgentChatColor("")).toBe(DEFAULT_AGENT_CHAT_COLOR)
  expect(resolveAgentChatColor("#f60f74")).toBe("#f60f74")
  expect(resolveAgentChatColor("rouge")).toBe(DEFAULT_AGENT_CHAT_COLOR)
})

test("le texte de la bulle n'existe que fermé et non vide", () => {
  expect(visibleChatTeaser("Une question ?", false)).toBe("Une question ?")
  expect(visibleChatTeaser("  Une question ?  ", false)).toBe("Une question ?")
  expect(visibleChatTeaser("Une question ?", true)).toBeNull()
  expect(visibleChatTeaser("", false)).toBeNull()
  expect(visibleChatTeaser("   ", false)).toBeNull()
  expect(visibleChatTeaser(null, false)).toBeNull()
})

test("un accent clair prend un texte sombre", () => {
  expect(chatAccentForeground("#171717")).toBe("#fafafa")
  expect(chatAccentForeground("#ffffff")).toBe("#171717")
})

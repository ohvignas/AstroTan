import { expect, test } from "vitest"
import { MAX_AGENT_INSTRUCTIONS } from "../content"
import {
  DEFAULT_AGENT_INSTRUCTIONS,
  MINIMAL_AGENT_INSTRUCTIONS,
  hasAuthoredAgentInstructions,
} from "./defaultAgentInstructions"

test("la consigne par défaut est un brief visiteur, sans marque figée", () => {
  expect(DEFAULT_AGENT_INSTRUCTIONS).toMatch(/assistant du site/)
  expect(DEFAULT_AGENT_INSTRUCTIONS).toMatch(/pages publiées/)
  expect(DEFAULT_AGENT_INSTRUCTIONS).toMatch(/base de savoir/)
  expect(DEFAULT_AGENT_INSTRUCTIONS).toMatch(/agenda/)
  expect(DEFAULT_AGENT_INSTRUCTIONS).toMatch(/N'invente/)
  expect(DEFAULT_AGENT_INSTRUCTIONS).toMatch(/liste à puces/)
  expect(DEFAULT_AGENT_INSTRUCTIONS).not.toMatch(/AstroTan/)
  expect(DEFAULT_AGENT_INSTRUCTIONS.length).toBeLessThanOrEqual(MAX_AGENT_INSTRUCTIONS)
})

test("le minimal ne promet ni marque ni agenda", () => {
  expect(MINIMAL_AGENT_INSTRUCTIONS).toMatch(/assistant/)
  expect(MINIMAL_AGENT_INSTRUCTIONS).toMatch(/liste à puces/)
  expect(MINIMAL_AGENT_INSTRUCTIONS).not.toMatch(/AstroTan/)
  expect(MINIMAL_AGENT_INSTRUCTIONS).not.toMatch(/agenda|créneau|calendrier/i)
})

test("une chaîne vide ou blanche n'est pas une consigne, c'est une absence", () => {
  expect(hasAuthoredAgentInstructions(undefined)).toBe(false)
  expect(hasAuthoredAgentInstructions(null)).toBe(false)
  expect(hasAuthoredAgentInstructions("")).toBe(false)
  expect(hasAuthoredAgentInstructions("   \n")).toBe(false)
  expect(hasAuthoredAgentInstructions("Sois bref.")).toBe(true)
})

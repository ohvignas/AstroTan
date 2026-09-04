import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import {
  DEFAULT_AGENT_INSTRUCTIONS,
  MINIMAL_AGENT_INSTRUCTIONS,
} from "./defaultAgentInstructions"
import { buildInstructions, type AgentConfig } from "./visitorAgent"

const here = dirname(fileURLToPath(import.meta.url))

const base: AgentConfig = {
  agentKnowledge: null,
  openRouterModel: null,
  openRouterAgentModel: null,
  agentEnabled: true,
  siteName: "AstroTan",
  agentDisplayName: "Léa",
  agentInstructions: null,
}

test("sans consigne, le brief minimal ne reprend ni la marque ni l'agenda", () => {
  const text = buildInstructions(base)
  expect(text).toBe(MINIMAL_AGENT_INSTRUCTIONS)
  expect(text).not.toContain("AstroTan")
  expect(text).not.toContain("Léa")
  expect(text).not.toContain("bienvenue")
  expect(text).not.toMatch(/outil calendrier|n'est pas connecté/)
})

test("la consigne saisie est la seule source, y compris si on la vide", () => {
  expect(buildInstructions({ ...base, agentInstructions: "Sois bref." })).toBe("Sois bref.")
  expect(buildInstructions({ ...base, agentInstructions: "" })).toBe(MINIMAL_AGENT_INSTRUCTIONS)
  expect(buildInstructions({ ...base, agentInstructions: DEFAULT_AGENT_INSTRUCTIONS })).toBe(
    DEFAULT_AGENT_INSTRUCTIONS,
  )
})

test("le savoir rédigé s'ajoute après la consigne, sans réécrire l'identité", () => {
  const text = buildInstructions({
    ...base,
    agentInstructions: "Sois bref.",
    agentKnowledge: "Horaires : 9h-18h",
  })
  expect(text).toContain("Sois bref.")
  expect(text).toContain("Horaires : 9h-18h")
  expect(text).not.toContain("Tu es Léa")
})

test("le bloc contexte porte toujours la date du jour", () => {
  const nowMs = Date.parse("2026-09-04T02:19:00+02:00")
  const text = buildInstructions(base, { nowMs, calendarConnected: true })
  expect(text).toContain(MINIMAL_AGENT_INSTRUCTIONS)
  expect(text).toContain("2026-09-04")
  expect(text).toMatch(/vendredi 4 septembre 2026/i)
  expect(text).toContain("2026-09-05")
  expect(text).toMatch(/Agenda principal lié : oui/)
})

test("makeVisitorAgent lit le modèle agent, pas seulement le modèle texte", async () => {
  const source = await readFile(join(here, "visitorAgent.ts"), "utf8")
  expect(source).toContain("resolveOpenRouterAgentModel")
  expect(source).toContain("privee.openRouterAgentModel")
  expect(source).toContain("privee.openRouterModel")
  expect(source).not.toMatch(
    /languageModel:\s*openrouter\.chat\(resolveOpenRouterModel\(privee\.openRouterModel\)\)/,
  )
})

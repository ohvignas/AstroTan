import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import {
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_MODELS,
  assertOpenRouterModel,
  isOpenRouterModelId,
  resolveOpenRouterAgentModel,
  resolveOpenRouterModel,
} from "./openRouterModels"

function codeDe(fn: () => unknown) {
  try {
    fn()
    throw new Error("aurait dû lever")
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError)
    return (e as ConvexError<{ code: string }>).data
  }
}

test("la liste est courte et contient le défaut", () => {
  expect(OPENROUTER_MODELS.length).toBe(6)
  expect(isOpenRouterModelId(DEFAULT_OPENROUTER_MODEL)).toBe(true)
  expect(DEFAULT_OPENROUTER_MODEL).toBe("google/gemini-3.7-flash")
  expect(OPENROUTER_MODELS.map((model) => model.id)).toEqual([
    "google/gemini-3.7-flash",
    "x-ai/grok-4.6",
    "google/gemini-3.1-pro-preview",
    "openai/gpt-5.6-sol",
    "anthropic/claude-opus-5",
    "deepseek/deepseek-v4-pro-0813",
  ])
  const ids = OPENROUTER_MODELS.map((model) => model.id)
  expect(ids).not.toContain("openai/gpt-4o-mini")
  expect(ids).not.toContain("openai/gpt-4o")
  expect(ids).not.toContain("google/gemini-2.5-flash")
  expect(ids).not.toContain("anthropic/claude-sonnet-4")
})

test("chaque entrée a un id auteur/slug et un libellé français", () => {
  for (const model of OPENROUTER_MODELS) {
    expect(model.id).toMatch(/^[a-z0-9.-]+\/[a-z0-9.-]+$/)
    expect(model.label.length).toBeGreaterThan(3)
    expect(model.label).not.toMatch(/[A-Z]{4,}/)
  }
})

test("assert refuse un id hors liste ; null efface", () => {
  expect(assertOpenRouterModel(undefined)).toBeUndefined()
  expect(assertOpenRouterModel(null)).toBeUndefined()
  expect(assertOpenRouterModel("")).toBeUndefined()
  expect(assertOpenRouterModel("google/gemini-3.7-flash")).toBe(
    "google/gemini-3.7-flash",
  )
  expect(assertOpenRouterModel("x-ai/grok-4.6")).toBe("x-ai/grok-4.6")
  expect(codeDe(() => assertOpenRouterModel("openai/gpt-nexiste-pas")).code).toBe(
    "INVALID_OPENROUTER_MODEL",
  )
})

test("resolve retombe sur le défaut si absent ou inconnu", () => {
  expect(resolveOpenRouterModel(null)).toBe(DEFAULT_OPENROUTER_MODEL)
  expect(resolveOpenRouterModel("inconnu/modele")).toBe(DEFAULT_OPENROUTER_MODEL)
  expect(resolveOpenRouterModel("google/gemini-3.7-flash")).toBe(
    "google/gemini-3.7-flash",
  )
  expect(resolveOpenRouterModel("anthropic/claude-opus-5")).toBe(
    "anthropic/claude-opus-5",
  )
  expect(resolveOpenRouterModel("openai/gpt-4o-mini")).toBe(DEFAULT_OPENROUTER_MODEL)
})

test("resolve agent : modèle agent, sinon texte, sinon défaut", () => {
  expect(
    resolveOpenRouterAgentModel("google/gemini-3.7-flash", "x-ai/grok-4.6"),
  ).toBe("google/gemini-3.7-flash")
  expect(resolveOpenRouterAgentModel(null, "x-ai/grok-4.6")).toBe("x-ai/grok-4.6")
  expect(resolveOpenRouterAgentModel(undefined, null)).toBe(DEFAULT_OPENROUTER_MODEL)
  expect(resolveOpenRouterAgentModel("inconnu/modele", "x-ai/grok-4.6")).toBe(
    "x-ai/grok-4.6",
  )
})

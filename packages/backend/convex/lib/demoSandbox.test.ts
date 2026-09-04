import { ConvexError } from "convex/values"
import { afterEach, beforeEach, expect, test } from "vitest"
import {
  demoSandboxActif,
  estCompteDemo,
  exigerPasDemo,
  modeleEffectif,
  modeleSandbox,
} from "./demoSandbox"

let originalEnv: NodeJS.ProcessEnv
beforeEach(() => {
  originalEnv = { ...process.env }
  delete process.env.DEMO_SANDBOX
  delete process.env.DEMO_ACCOUNT_EMAIL
  delete process.env.DEMO_OPENROUTER_MODEL
})
afterEach(() => {
  process.env = originalEnv
})

function codeDe(fn: () => unknown) {
  try {
    fn()
    throw new Error("aurait dû lever")
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError)
    return (e as ConvexError<{ code: string }>).data
  }
}

test("demoSandboxActif n'est vrai que pour la chaîne true", () => {
  expect(demoSandboxActif({})).toBe(false)
  expect(demoSandboxActif({ DEMO_SANDBOX: "1" })).toBe(false)
  expect(demoSandboxActif({ DEMO_SANDBOX: "true" })).toBe(true)
})

test("estCompteDemo compare l'e-mail normalisé, seulement si le flag est on", () => {
  const env = {
    DEMO_SANDBOX: "true",
    DEMO_ACCOUNT_EMAIL: "Demo@AstroTan.invalid",
  }
  expect(estCompteDemo({ email: "demo@astrotan.invalid" }, env)).toBe(true)
  expect(estCompteDemo({ email: "owner@illith.com" }, env)).toBe(false)
  expect(estCompteDemo({ email: "demo@astrotan.invalid" }, {})).toBe(false)
})

test("modeleSandbox lit l'env et ignore le settings", () => {
  expect(modeleSandbox({ openRouterModel: "x-ai/grok-4.6" }, {})).toBeNull()
  expect(
    modeleSandbox(
      { openRouterModel: "x-ai/grok-4.6" },
      { DEMO_SANDBOX: "true", DEMO_OPENROUTER_MODEL: "google/gemini-3.7-flash" },
    ),
  ).toBe("google/gemini-3.7-flash")
})

test("modeleSandbox avec flag on et slug env vide ou absent renvoie null", () => {
  const settings = { openRouterModel: "x-ai/grok-4.6" }
  const envOn = { DEMO_SANDBOX: "true" }
  expect(modeleSandbox(settings, envOn)).toBeNull()
  expect(modeleSandbox(settings, { ...envOn, DEMO_OPENROUTER_MODEL: "" })).toBeNull()
  expect(modeleSandbox(settings, { ...envOn, DEMO_OPENROUTER_MODEL: "   " })).toBeNull()
})

test("exigerPasDemo lève DEMO_FORBIDDEN pour le compte démo, sinon no-op", () => {
  const env = {
    DEMO_SANDBOX: "true",
    DEMO_ACCOUNT_EMAIL: "demo@astrotan.invalid",
  }
  expect(codeDe(() => exigerPasDemo({ email: "demo@astrotan.invalid" }, env))).toEqual({
    code: "DEMO_FORBIDDEN",
  })
  expect(() => exigerPasDemo({ email: "owner@illith.com" }, env)).not.toThrow()
  expect(() => exigerPasDemo({ email: "demo@astrotan.invalid" }, {})).not.toThrow()
})

test("modeleEffectif passe le settings hors sandbox, sinon le slug env tel quel", () => {
  expect(modeleEffectif("x-ai/grok-4.6", {})).toBe("x-ai/grok-4.6")
  expect(modeleEffectif(null, {})).toBeNull()
  expect(
    modeleEffectif("x-ai/grok-4.6", {
      DEMO_SANDBOX: "true",
      DEMO_OPENROUTER_MODEL: "some/free-model-not-in-picker",
    }),
  ).toBe("some/free-model-not-in-picker")
  expect(
    modeleEffectif("x-ai/grok-4.6", {
      DEMO_SANDBOX: "true",
      DEMO_OPENROUTER_MODEL: "",
    }),
  ).toBeNull()
})

import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import {
  DEFAULT_OPENROUTER_OCR_MODEL,
  OPENROUTER_OCR_ENGINE,
  OPENROUTER_OCR_MODELS,
  assertOpenRouterOcrModel,
  isOpenRouterOcrModelId,
  resolveOpenRouterOcrModel,
} from "./openRouterOcrModels"

function codeDe(fn: () => unknown) {
  try {
    fn()
    throw new Error("aurait dû lever")
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError)
    return (e as ConvexError<{ code: string }>).data
  }
}

test("le défaut est Gemini 2.5 Flash, slug OpenRouter réel, moteur OCR Mistral", () => {
  expect(OPENROUTER_OCR_ENGINE).toBe("mistral-ocr")
  expect(DEFAULT_OPENROUTER_OCR_MODEL).toBe("google/gemini-2.5-flash")
  expect(isOpenRouterOcrModelId(DEFAULT_OPENROUTER_OCR_MODEL)).toBe(true)
  expect(OPENROUTER_OCR_MODELS.map((model) => model.id)).toEqual([
    "google/gemini-2.5-flash",
    "google/gemini-3.1-pro-preview",
    "qwen/qwen3-vl-235b-a22b-instruct",
    "openai/gpt-5.5",
  ])
  expect(OPENROUTER_OCR_MODELS[0]?.label).toMatch(/OCR Mistral/)
})

test("assert refuse un id hors liste ; null efface", () => {
  expect(assertOpenRouterOcrModel(undefined)).toBeUndefined()
  expect(assertOpenRouterOcrModel(null)).toBeUndefined()
  expect(assertOpenRouterOcrModel("")).toBeUndefined()
  expect(assertOpenRouterOcrModel("google/gemini-2.5-flash")).toBe(
    "google/gemini-2.5-flash",
  )
  expect(codeDe(() => assertOpenRouterOcrModel("mistralai/mistral-ocr-latest")).code).toBe(
    "INVALID_OPENROUTER_OCR_MODEL",
  )
})

test("resolve retombe sur le défaut si absent ou inconnu", () => {
  expect(resolveOpenRouterOcrModel(null)).toBe(DEFAULT_OPENROUTER_OCR_MODEL)
  expect(resolveOpenRouterOcrModel("inconnu/modele")).toBe(DEFAULT_OPENROUTER_OCR_MODEL)
  expect(resolveOpenRouterOcrModel("openai/gpt-5.5")).toBe("openai/gpt-5.5")
})

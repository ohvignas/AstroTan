import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import {
  DEFAULT_OPENROUTER_IMAGE_MODEL,
  OPENROUTER_IMAGE_MODELS,
  assertOpenRouterImageModel,
  isOpenRouterImageModelId,
  resolveOpenRouterImageModel,
} from "./openRouterImageModels"

function codeDe(fn: () => unknown) {
  try {
    fn()
    throw new Error("aurait dû lever")
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError)
    return (e as ConvexError<{ code: string }>).data
  }
}

test("le défaut est le flagship Gemini Pro Image, slug vérifié", () => {
  expect(DEFAULT_OPENROUTER_IMAGE_MODEL).toBe("google/gemini-3-pro-image")
  expect(isOpenRouterImageModelId(DEFAULT_OPENROUTER_IMAGE_MODEL)).toBe(true)
  expect(OPENROUTER_IMAGE_MODELS.map((model) => model.id)).toEqual([
    "google/gemini-3-pro-image",
    "google/gemini-3.1-flash-image",
    "google/gemini-2.5-flash-image",
  ])
})

test("assert refuse un id hors liste ; null efface", () => {
  expect(assertOpenRouterImageModel(undefined)).toBeUndefined()
  expect(assertOpenRouterImageModel(null)).toBeUndefined()
  expect(assertOpenRouterImageModel("")).toBeUndefined()
  expect(assertOpenRouterImageModel("google/gemini-3-pro-image")).toBe(
    "google/gemini-3-pro-image",
  )
  expect(codeDe(() => assertOpenRouterImageModel("openai/gpt-image-2")).code).toBe(
    "INVALID_OPENROUTER_IMAGE_MODEL",
  )
})

test("resolve retombe sur le défaut si absent ou inconnu", () => {
  expect(resolveOpenRouterImageModel(null)).toBe(DEFAULT_OPENROUTER_IMAGE_MODEL)
  expect(resolveOpenRouterImageModel("inconnu/modele")).toBe(
    DEFAULT_OPENROUTER_IMAGE_MODEL,
  )
  expect(resolveOpenRouterImageModel("google/gemini-2.5-flash-image")).toBe(
    "google/gemini-2.5-flash-image",
  )
})

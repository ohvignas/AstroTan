import { expect, test, vi } from "vitest"
import {
  EXTRACT_ERRORS,
  ExtractFailure,
  describeExtractFailure,
  withExtractTimeout,
} from "./extractErrors"

test("une ExtractFailure porte le message français du code", () => {
  expect(new ExtractFailure("timeout").message).toBe(EXTRACT_ERRORS.timeout)
  expect(new ExtractFailure("empty").message).toBe(EXTRACT_ERRORS.empty)
  expect(new ExtractFailure("noKey").message).toMatch(/OpenRouter/)
  expect(new ExtractFailure("ocr").message).toMatch(/OCR/)
  expect(EXTRACT_ERRORS).not.toHaveProperty("tooManyPages")
})

test("describeExtractFailure garde le message d'une ExtractFailure", () => {
  expect(describeExtractFailure(new ExtractFailure("missing"))).toBe(EXTRACT_ERRORS.missing)
})

test("describeExtractFailure masque une erreur technique derrière le refus générique", () => {
  expect(describeExtractFailure(new TypeError("o(...)(...) is not a function"))).toBe(
    EXTRACT_ERRORS.parse,
  )
  expect(describeExtractFailure("nope")).toBe(EXTRACT_ERRORS.parse)
})

test("describeExtractFailure relit un code ou un message déjà posé (frontière d'action)", () => {
  expect(describeExtractFailure({ code: "ocr" })).toBe(EXTRACT_ERRORS.ocr)
  expect(describeExtractFailure({ code: "noKey" })).toBe(EXTRACT_ERRORS.noKey)
  expect(describeExtractFailure({ code: "empty" })).toBe(EXTRACT_ERRORS.empty)
  expect(describeExtractFailure({ message: EXTRACT_ERRORS.timeout })).toBe(
    EXTRACT_ERRORS.timeout,
  )
})

test("withExtractTimeout rend le résultat si le travail finit à temps", async () => {
  await expect(withExtractTimeout(Promise.resolve("ok"), 50)).resolves.toBe("ok")
})

test("withExtractTimeout échoue proprement si le travail dépasse le délai", async () => {
  vi.useFakeTimers()
  try {
    const pending = withExtractTimeout(new Promise<string>(() => undefined), 40)
    const assertion = expect(pending).rejects.toMatchObject({
      name: "ExtractFailure",
      message: EXTRACT_ERRORS.timeout,
    })
    await vi.advanceTimersByTimeAsync(40)
    await assertion
  } finally {
    vi.useRealTimers()
  }
})

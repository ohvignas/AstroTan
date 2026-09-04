import { expect, test } from "vitest"
import {
  COVER_ASPECT_RATIO,
  COVER_RESOLUTION,
  coverGenerationParams,
} from "./coverImage"

test("les modèles qui exposent resolution reçoivent 1K 16:9", () => {
  expect(COVER_ASPECT_RATIO).toBe("16:9")
  expect(COVER_RESOLUTION).toBe("1K")
  expect(coverGenerationParams("google/gemini-3-pro-image")).toEqual({
    aspect_ratio: "16:9",
    resolution: "1K",
  })
  expect(coverGenerationParams("google/gemini-3.1-flash-image")).toEqual({
    aspect_ratio: "16:9",
    resolution: "1K",
  })
})

test("gemini-2.5-flash-image n'a pas de resolution — on n'en envoie pas", () => {
  expect(coverGenerationParams("google/gemini-2.5-flash-image")).toEqual({
    aspect_ratio: "16:9",
  })
  expect(coverGenerationParams("google/gemini-2.5-flash-image")).not.toHaveProperty(
    "resolution",
  )
})

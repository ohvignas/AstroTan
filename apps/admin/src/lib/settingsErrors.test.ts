import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import { describeSettingsError } from "./settingsErrors"

test("INVALID_PIXEL_ID a une phrase", () => {
  expect(
    describeSettingsError(new ConvexError({ code: "INVALID_PIXEL_ID", field: "metaPixelId" })),
  ).toMatch(/pixel|identifiant/i)
})

test("INVALID_OPENROUTER_MODEL a une phrase", () => {
  expect(
    describeSettingsError(new ConvexError({ code: "INVALID_OPENROUTER_MODEL" })),
  ).toMatch(/modèle/i)
})

test("INVALID_OPENROUTER_OCR_MODEL a une phrase", () => {
  expect(
    describeSettingsError(new ConvexError({ code: "INVALID_OPENROUTER_OCR_MODEL" })),
  ).toMatch(/OCR/)
})

test("OPENROUTER_NOT_CONFIGURED pointe vers la section Modèle IA", () => {
  expect(
    describeSettingsError(new ConvexError({ code: "OPENROUTER_NOT_CONFIGURED" })),
  ).toMatch(/Modèle IA/)
})

test("INVALID_SOCIAL_URL a une phrase", () => {
  expect(
    describeSettingsError(new ConvexError({ code: "INVALID_SOCIAL_URL" })),
  ).toMatch(/http/)
})

test("INVALID_AGENT_CHAT_COLOR a une phrase", () => {
  expect(
    describeSettingsError(new ConvexError({ code: "INVALID_AGENT_CHAT_COLOR" })),
  ).toMatch(/hex|couleur|#/i)
})

import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import { describeSettingsError } from "./settingsErrors"

test("INVALID_PIXEL_ID a une phrase", () => {
  expect(
    describeSettingsError(new ConvexError({ code: "INVALID_PIXEL_ID", field: "metaPixelId" })),
  ).toMatch(/pixel|identifiant/i)
})

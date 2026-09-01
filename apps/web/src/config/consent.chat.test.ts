import { expect, test } from "vitest"

test("consentVersion reste 1.0.0 tant que le chat n'a pas de cookie", async () => {
  const { consentConfig } = await import("./consent")
  expect(consentConfig.consentVersion).toBe("1.0.0")
})

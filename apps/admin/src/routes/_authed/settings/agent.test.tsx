import { describe, expect, test } from "vitest"
import source from "./agent.tsx?raw"

describe("settings/agent — chrome des réglages", () => {
  test("porte la barre d'enregistrement, pas seulement l'en-tête", () => {
    expect(source).toContain("SettingsFormShell")
    expect(source).toContain("useAutoSave")
    expect(source).not.toContain("SettingsPageShell")
  })

  test("enregistre via settings.updateAgent, jamais settings.update", () => {
    expect(source).toContain("api.settings.updateAgent")
    expect(source).not.toMatch(/api\.settings\.update[^A-Za-z]/)
  })

  test("importe les bornes depuis content, pas depuis settings", () => {
    expect(source).toContain("@astrotan/backend/convex/content")
    expect(source).not.toContain("@astrotan/backend/convex/settings")
  })
})

import { describe, expect, test } from "vitest"
import source from "./ia.tsx?raw"

describe("settings/ia — signet", () => {
  test("redirige vers /settings/agent, plus de formulaire", () => {
    expect(source).toContain("throw redirect")
    expect(source).toContain("/settings/agent")
    expect(source).not.toContain("AiPage")
    expect(source).not.toContain("SettingsFormShell")
    expect(source).not.toContain("useAutoSave")
  })
})

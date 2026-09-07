import { expect, test } from "vitest"
import source from "./app-sidebar.tsx?raw"

test("Réglages est toujours dans la barre, plus seulement pour owner/admin", () => {
  expect(source).toContain("SETTINGS_ITEM")
  expect(source).not.toMatch(/canWriteSettings &&/)
  expect(source).toContain("<NavMain items={[SETTINGS_ITEM]}")
})

test("Statistiques ouvre le share Umami, jamais le SSO ni le login", () => {
  expect(source).toContain("api.analytics.umamiLinks")
  expect(source).toContain("umami.dashboard")
  expect(source).toContain("external: true")
  expect(source).not.toContain("statsSsoItem")
  expect(source).not.toContain("ssoLink")
  expect(source).not.toContain("analytics.ssoLink")
})

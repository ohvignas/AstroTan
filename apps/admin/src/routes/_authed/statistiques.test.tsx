import { expect, test } from "vitest"
import source from "./statistiques.tsx?raw"

test("Statistiques redirige vers le share Umami, jamais le SSO", () => {
  expect(source).toContain("window.location.replace")
  expect(source).toContain("umami.dashboard")
  expect(source).toContain("SiteDashboardPanel")
  expect(source).not.toContain("ssoLink")
  expect(source).not.toContain("analytics.ssoLink")
})

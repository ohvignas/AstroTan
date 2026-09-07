import { expect, test } from "vitest"
import source from "./statistiques.tsx?raw"

test("Statistiques est l'écran d'audience, plus un relais SSO Umami", () => {
  expect(source).toContain("SiteDashboardPanel")
  expect(source).not.toContain("ssoLink")
  expect(source).not.toContain("analytics.ssoLink")
  expect(source).not.toContain("Ouverture d'Umami")
  expect(source).not.toContain("window.location.replace")
})

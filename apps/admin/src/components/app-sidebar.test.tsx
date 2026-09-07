import { expect, test } from "vitest"
import source from "./app-sidebar.tsx?raw"

test("Réglages est toujours dans la barre, plus seulement pour owner/admin", () => {
  expect(source).toContain("SETTINGS_ITEM")
  expect(source).not.toMatch(/canWriteSettings &&/)
  expect(source).toContain("<NavMain items={[SETTINGS_ITEM]}")
})

test("Statistiques est une route interne, pas un lien Umami", () => {
  expect(source).toContain('url: "/statistiques"')
  expect(source).not.toContain("statsSsoItem")
  expect(source).not.toContain("statsItem")
  expect(source).not.toContain("umami.dashboard")
  expect(source).not.toContain("external: true")
})

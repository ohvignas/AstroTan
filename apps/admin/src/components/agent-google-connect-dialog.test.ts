import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const dir = dirname(fileURLToPath(import.meta.url))
const dialog = readFileSync(join(dir, "agent-google-connect-dialog.tsx"), "utf8")
const setup = readFileSync(join(dir, "agent-google-connect-setup.tsx"), "utf8")
const urls = readFileSync(join(dir, "googleOAuthUrls.ts"), "utf8")
const source = `${dialog}\n${setup}\n${urls}`

test("dialog Google : libellés FR, secret Calendar, pas settings.get", () => {
  expect(source).toContain("Connecter Google Agenda")
  expect(source).toContain("Continuer vers Google")
  expect(source).toContain("GOOGLE_CALENDAR_CLIENT_SECRET")
  expect(source).not.toContain("api.settings.get")
})

test("paramétrage repliable : conseils, URLs dynamiques, boutons copier", () => {
  expect(source).toContain("Paramétrage")
  expect(source).toContain("Collapsible")
  expect(source).toContain("Origine JavaScript")
  expect(source).toContain("URI de redirection")
  expect(source).toContain("CopyButton")
  expect(source).toContain("/api/connectors/google/callback")
  expect(source).toContain("Application Web")
  expect(source).not.toContain("http://localhost:3001")
  expect(source).not.toContain("DropdownMenu")
})

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const dir = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(dir, "agent-mcp-dialog.tsx"), "utf8")

test("dialog MCP : nom + URL, pas de choix de transport", () => {
  expect(source).toContain("inferMcpTransport")
  expect(source).toContain("Ouvrir la connexion")
  expect(source).toContain("setHeaders")
  expect(source).toContain("beginAuthorize")
  expect(source).toContain("needsMcpOAuth")
  expect(source).toContain("L'autorisation a été refusée")
  expect(source).toContain("min-h-11")
  expect(source.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(3)
  expect(source).not.toContain("AgentMcpTransportField")
  expect(source).not.toContain("nextMcpTransport")
  expect(source).not.toContain("radiogroup")
  expect(source).not.toContain("HTTP streamable")
  expect(source).not.toContain("choisissez")
  expect(source).not.toContain("Make")
  expect(source).not.toContain("stdio")
  expect(source).not.toContain('value="stdio"')
  expect(source).not.toContain('type="file"')
  expect(source).not.toContain("mcp.json")
})

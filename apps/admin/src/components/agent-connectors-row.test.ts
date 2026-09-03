import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const dir = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(dir, "agent-connectors-row.tsx"), "utf8")

describe("rangée de connecteurs", () => {
  test("un clic Agenda, un ajout MCP, rien dans settings.get", () => {
    expect(source).toContain("Connecter son agenda")
    expect(source).toContain("Ajouter un connecteur")
    expect(source).toContain("GoogleCalendarMark")
    expect(source).toContain("api.connectors.googleStatus")
    expect(source).toContain("api.connectors.googleAuthUrl")
    expect(source).toContain("api.mcpServers.create")
    expect(source).toContain("inferMcpTransport")
    expect(source).not.toMatch(/value=["']stdio["']/)
    expect(source).not.toContain("api.settings.get")
    expect(source).not.toContain("*.convex.site")
    expect(source).toContain("min-h-11")
    const mcpList = source.indexOf("<AgentMcpList")
    const addBtn = source.indexOf("Ajouter un connecteur")
    const googleMark = source.indexOf("<GoogleCalendarMark")
    expect(mcpList).toBeGreaterThan(googleMark)
    expect(mcpList).toBeLessThan(addBtn)
    expect(source).not.toContain("api.mcpServers.setEnabled")
  })
})

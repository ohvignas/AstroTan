import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const dir = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(dir, "agent-mcp-list.tsx"), "utf8")

describe("cartes MCP", () => {
  test("même carte que Google : favicon, titre, sous-titre, Déconnecter", () => {
    expect(source).toContain("AgentConnectorCard")
    expect(source).toContain("faviconCandidates")
    expect(source).toContain("PlugIcon")
    expect(source).toContain("Déconnecter")
    expect(source).toContain("server.name")
    expect(source).toContain("mcpConnectorSubtitle")
    expect(source).not.toContain("Trash2Icon")
    expect(source).not.toContain("server.transport")
    expect(source).not.toContain("[sse]")
    expect(source).not.toContain("Switch")
    expect(source).not.toContain("en-têtes configurés")
  })
})

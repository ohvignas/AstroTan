import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const dir = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(dir, "agent-mcp-list.tsx"), "utf8")

describe("tuiles MCP", () => {
  test("tuile compacte : favicon, nom, Retirer — pas de liste ni de [sse]", () => {
    expect(source).toContain("faviconCandidates")
    expect(source).toContain("PlugIcon")
    expect(source).toContain("Retirer")
    expect(source).toContain("Trash2Icon")
    expect(source).toContain("server.name")
    expect(source).not.toContain("server.transport")
    expect(source).not.toContain("[sse]")
    expect(source).not.toContain("Switch")
    expect(source).not.toContain("flex-col")
    expect(source).not.toContain("en-têtes configurés")
  })
})

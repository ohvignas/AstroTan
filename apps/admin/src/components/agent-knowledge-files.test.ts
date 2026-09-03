import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "agent-knowledge-files.tsx"),
  "utf8",
)

describe("carte base de savoir", () => {
  test("réindexe fichier par fichier, sans bouton global ni nouvel écran", () => {
    expect(source).not.toContain("Réindexer")
    expect(source).not.toContain("api.rag.reindex")
    expect(source).toContain("AgentKnowledgeFileRow")
    expect(source).toContain("api.agentKnowledge.reindexFile")
    expect(source).not.toContain("Documents lus par l'agent")
    expect(source).not.toContain("Jamais indexé")
    expect(source).not.toContain("brouillons ne sont jamais")
    expect(source).not.toContain("OcrModelSelect")
    expect(source).not.toContain("openRouterOcrModel")
    expect(source).not.toContain("api.settings.getPrivate")
    expect(source).not.toContain("Réessayer")
    expect(source).not.toMatch(/api\.settings\.get[^P]/)
  })
})

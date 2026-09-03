import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import {
  canReindexKnowledgeFile,
  canViewKnowledgeMarkdown,
} from "./agent-knowledge-file-row"

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "agent-knowledge-file-row.tsx"),
  "utf8",
)

describe("ligne d'un document de savoir", () => {
  test("trois icônes lucide, libellés français, zone de 44 px", () => {
    expect(source).toContain("Trash2")
    expect(source).toContain("RefreshCw")
    expect(source).toContain("Eye")
    expect(source).toContain("Supprimer")
    expect(source).toContain("Réindexer")
    expect(source).toContain("Voir le markdown")
    expect(source).toContain("extractedMarkdown")
    expect(source).toContain("size-11")
    expect(source).toContain("text-destructive")
    expect(source).toContain("knowledgeFileStatusModel")
    expect(source).toContain("Loader2")
    expect(source).toContain("Check")
    expect(source).toContain("animate-spin")
    expect(source).toContain("text-emerald-600")
    expect(source).not.toContain("Réessayer")
  })

  test("l'œil exige un markdown, la réindexation aussi sauf après une erreur", () => {
    const indexed = {
      _id: "file-1",
      filename: "faq.md",
      extractedMarkdown: "# FAQ\n\nRéponse.",
    }
    const extracting = { _id: "a", filename: "scan.pdf", extractedMarkdown: "" }
    const failed = {
      _id: "b",
      filename: "scan.pdf",
      extractedMarkdown: "",
      extractError: "OCR impossible",
    }
    expect(canViewKnowledgeMarkdown(indexed)).toBe(true)
    expect(canReindexKnowledgeFile(indexed)).toBe(true)
    expect(canViewKnowledgeMarkdown(extracting)).toBe(false)
    expect(canReindexKnowledgeFile(extracting)).toBe(false)
    expect(canViewKnowledgeMarkdown(failed)).toBe(false)
    expect(canReindexKnowledgeFile(failed)).toBe(true)
    const ocrRunning = {
      _id: "c",
      filename: "bootcamp.pdf",
      extractedMarkdown: "# Module 1",
      ocrPage: 10,
      ocrTotal: 100,
    }
    expect(canReindexKnowledgeFile(ocrRunning)).toBe(false)
    expect(canViewKnowledgeMarkdown(ocrRunning)).toBe(true)
  })
})

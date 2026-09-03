import { expect, test } from "vitest"
import {
  extractKnowledgeMarkdown,
  inferKnowledgeMime,
  isTextKnowledgeFile,
} from "./extractKnowledge"

const enc = new TextEncoder()

test("un fichier .md devient le markdown tel quel", () => {
  const bytes = enc.encode("# Horaires\n\nOuvert 9h–18h.\n")
  expect(extractKnowledgeMarkdown(bytes, "text/markdown", "faq.md")).toBe(
    "# Horaires\n\nOuvert 9h–18h.",
  )
})

test("un fichier .txt devient du markdown", () => {
  const bytes = enc.encode("Tarif : 80 €\n")
  expect(extractKnowledgeMarkdown(bytes, "text/plain", "tarifs.txt")).toBe("Tarif : 80 €")
})

test("un .md sans MIME déclaré se reconnaît à l'extension", () => {
  const bytes = enc.encode("## Contact\n\n04 00 00 00 00")
  expect(extractKnowledgeMarkdown(bytes, "application/octet-stream", "contact.md")).toBe(
    "## Contact\n\n04 00 00 00 00",
  )
})

test("un type inconnu est refusé", () => {
  expect(() =>
    extractKnowledgeMarkdown(enc.encode("%PDF"), "application/pdf", "doc.pdf"),
  ).toThrow(/UNSUPPORTED_KNOWLEDGE_MIME/)
})

test("un .md ne passe jamais par le chemin PDF, même avec un MIME pdf", () => {
  expect(isTextKnowledgeFile("application/pdf", "faq.md")).toBe(true)
  expect(isTextKnowledgeFile("text/plain; charset=utf-8", "notes.md")).toBe(true)
})

test("un .pdf n'est jamais traité comme du texte, même en text/plain", () => {
  expect(isTextKnowledgeFile("text/plain", "bootcamp.pdf")).toBe(false)
  expect(isTextKnowledgeFile("application/pdf", "bootcamp.pdf")).toBe(false)
})

test("l'extension gagne sur un MIME vide ou générique", () => {
  expect(inferKnowledgeMime("", "bootcamp.pdf")).toBe("application/pdf")
  expect(inferKnowledgeMime("application/octet-stream", "faq.md")).toBe("text/markdown")
  expect(inferKnowledgeMime("text/plain", "notes.txt")).toBe("text/plain")
})

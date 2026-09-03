import { expect, test } from "vitest"
import { knowledgeFileBadge } from "./knowledgeFileBadge"

test("un markdown vide sans erreur reste en Extraction", () => {
  expect(knowledgeFileBadge({ extractedMarkdown: "" })).toBe("Extraction")
})

test("une erreur d'extraction n'est plus masquée par Extraction", () => {
  expect(
    knowledgeFileBadge({
      extractedMarkdown: "",
      extractError: "Impossible d'extraire le texte de ce fichier.",
    }),
  ).toBe("Erreur")
})

test("un fichier extrait sans index est À indexer", () => {
  expect(knowledgeFileBadge({ extractedMarkdown: "FAQ" })).toBe("À indexer")
})

test("un OCR en cours affiche la page atteinte, même avec un markdown partiel", () => {
  expect(
    knowledgeFileBadge({
      extractedMarkdown: "# Module 1",
      ocrPage: 45,
      ocrTotal: 200,
    }),
  ).toBe("OCR 45/200")
})

test("les statuts d'index restent visibles une fois le texte là", () => {
  expect(knowledgeFileBadge({ extractedMarkdown: "FAQ", indexStatus: "pending" })).toBe(
    "Indexation",
  )
  expect(knowledgeFileBadge({ extractedMarkdown: "FAQ", indexStatus: "indexed" })).toBe("Indexé")
  expect(knowledgeFileBadge({ extractedMarkdown: "FAQ", indexStatus: "error" })).toBe("Erreur")
})

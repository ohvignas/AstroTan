import { expect, test } from "vitest"
import {
  knowledgeFileStatusModel,
  knowledgeProgressPercent,
} from "./knowledgeProgressPercent"

test("sans ocrTotal, aucun pourcentage inventé — pas même 0 %", () => {
  expect(knowledgeProgressPercent({})).toBeNull()
  expect(knowledgeProgressPercent({ ocrPage: 0 })).toBeNull()
  expect(knowledgeProgressPercent({ ocrTotal: 0, ocrPage: 0 })).toBeNull()
  expect(knowledgeProgressPercent({ indexStatus: "pending" })).toBeNull()
})

test("OCR en cours : arrondi de ocrPage / ocrTotal", () => {
  expect(knowledgeProgressPercent({ ocrPage: 45, ocrTotal: 100 })).toBe(45)
  expect(knowledgeProgressPercent({ ocrPage: 1, ocrTotal: 3 })).toBe(33)
  expect(knowledgeProgressPercent({ ocrPage: 0, ocrTotal: 200 })).toBe(0)
})

test("l'indexation après l'OCR garde le dernier pourcentage", () => {
  expect(
    knowledgeProgressPercent({
      ocrPage: 200,
      ocrTotal: 200,
      indexStatus: "pending",
    }),
  ).toBe(100)
})

test("indexé vaut 100, même sans compteurs OCR", () => {
  expect(knowledgeProgressPercent({ indexStatus: "indexed" })).toBe(100)
  expect(
    knowledgeProgressPercent({
      ocrPage: 10,
      ocrTotal: 100,
      indexStatus: "indexed",
    }),
  ).toBe(100)
})

test("une erreur ne ment jamais avec 100 %", () => {
  expect(knowledgeProgressPercent({ indexStatus: "error" })).toBeNull()
  expect(
    knowledgeProgressPercent({
      ocrPage: 100,
      ocrTotal: 100,
      indexStatus: "error",
    }),
  ).toBeNull()
})

test("sans compteurs, spinner + Extraction… — jamais 0 %", () => {
  expect(knowledgeFileStatusModel({ extractedMarkdown: "" })).toEqual({
    kind: "working",
    label: "Extraction…",
    percent: null,
    nextHeld: null,
  })
})

test("OCR en cours : spinner + pourcentage", () => {
  expect(
    knowledgeFileStatusModel({
      extractedMarkdown: "# Module 1",
      ocrPage: 45,
      ocrTotal: 100,
    }),
  ).toEqual({
    kind: "working",
    label: "45 %",
    percent: 45,
    nextHeld: 45,
  })
})

test("indexation après l'OCR : garde le dernier % au lieu de revenir à 0", () => {
  expect(
    knowledgeFileStatusModel(
      { extractedMarkdown: "# FAQ", indexStatus: "pending" },
      87,
    ),
  ).toEqual({
    kind: "working",
    label: "87 %",
    percent: 87,
    nextHeld: 87,
  })
})

test("indexation sans % connu : Indexation…", () => {
  expect(
    knowledgeFileStatusModel({ extractedMarkdown: "# FAQ", indexStatus: "pending" }),
  ).toEqual({
    kind: "working",
    label: "Indexation…",
    percent: null,
    nextHeld: null,
  })
})

test("indexé : badge Indexé, pas de pourcentage affiché", () => {
  expect(
    knowledgeFileStatusModel({ extractedMarkdown: "# FAQ", indexStatus: "indexed" }),
  ).toEqual({
    kind: "indexed",
    label: "Indexé",
    percent: null,
    nextHeld: null,
  })
})

test("erreur : texte d'erreur, pas de 100 %", () => {
  expect(
    knowledgeFileStatusModel({
      extractedMarkdown: "",
      extractError: "OCR impossible",
      ocrPage: 100,
      ocrTotal: 100,
    }),
  ).toEqual({
    kind: "error",
    label: "Erreur",
    percent: null,
    nextHeld: null,
  })
})

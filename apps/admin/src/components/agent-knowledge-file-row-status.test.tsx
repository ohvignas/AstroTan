import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import {
  AgentKnowledgeFileRow,
  type KnowledgeFileRow,
} from "./agent-knowledge-file-row"

function render(file: KnowledgeFileRow) {
  return renderToStaticMarkup(
    <AgentKnowledgeFileRow
      file={file}
      disabled={false}
      busy={false}
      onRemove={() => undefined}
      onReindex={() => undefined}
    />,
  )
}

test("OCR en cours : spinner et pourcentage, pas le mot Extraction", () => {
  const html = render({
    _id: "f1",
    filename: "bootcamp.pdf",
    extractedMarkdown: "# Module 1",
    ocrPage: 45,
    ocrTotal: 100,
  })
  expect(html).toContain("animate-spin")
  expect(html).toContain("45 %")
  expect(html).not.toContain("Extraction")
  expect(html).not.toContain("100 %")
})

test("markdown vide sans totaux : spinner + Extraction…, pas 0 %", () => {
  const html = render({
    _id: "f2",
    filename: "faq.md",
    extractedMarkdown: "",
  })
  expect(html).toContain("animate-spin")
  expect(html).toContain("Extraction…")
  expect(html).not.toContain("0 %")
})

test("indexé : coche verte et Indexé", () => {
  const html = render({
    _id: "f3",
    filename: "faq.md",
    extractedMarkdown: "# FAQ",
    indexStatus: "indexed",
  })
  expect(html).toContain("text-emerald-600")
  expect(html).toContain("Indexé")
  expect(html).not.toContain("animate-spin")
  expect(html).not.toContain("Document indexé")
})

test("erreur d'extraction : le message reste, sans 100 %", () => {
  const html = render({
    _id: "f4",
    filename: "scan.pdf",
    extractedMarkdown: "",
    extractError: "OCR impossible",
    ocrPage: 100,
    ocrTotal: 100,
  })
  expect(html).toContain("OCR impossible")
  expect(html).not.toContain("100 %")
  expect(html).not.toContain("animate-spin")
})

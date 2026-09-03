import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { OcrModelSelect } from "./ocr-model-select"

test("porte le libellé Modèle OCR et OCR Mistral", () => {
  const html = renderToStaticMarkup(
    <OcrModelSelect canWrite openRouterOcrModel={null} onSave={async () => {}} />,
  )
  expect(html).toContain("Modèle OCR")
  expect(html).toContain("OCR Mistral")
})

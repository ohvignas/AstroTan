// @vitest-environment node
import { expect, test } from "vitest"
import { buildEmptyTextPdf, buildHelloPdf } from "../../testing/helloPdf"
import { EXTRACT_ERRORS } from "./extractErrors"
import { extractPdfText, inspectPdfText } from "./extractPdf"

test("un PDF texte rend son contenu", async () => {
  const text = await extractPdfText(buildHelloPdf("Hello AstroTan"))
  expect(text).toContain("Hello AstroTan")
})

test("inspectPdfText rend un calque vide sans lever", async () => {
  const layer = await inspectPdfText(buildEmptyTextPdf())
  expect(layer.totalPages).toBeGreaterThan(0)
  expect(layer.text).toBe("")
})

test("un PDF invalide lève le refus d'extraction, pas une TypeError nue", async () => {
  await expect(extractPdfText(new TextEncoder().encode("%PDF-not-a-pdf"))).rejects.toMatchObject({
    name: "ExtractFailure",
    message: EXTRACT_ERRORS.parse,
  })
})

test("isolatePdfBytes rend une copie que le détachement de l'original n'atteint pas", async () => {
  const { isolatePdfBytes } = await import("./extractPdf")
  const original = buildHelloPdf("copie")
  const copy = isolatePdfBytes(original)
  expect(copy).not.toBe(original)
  expect(copy.buffer).not.toBe(original.buffer)
  expect(copy).toEqual(original)
})

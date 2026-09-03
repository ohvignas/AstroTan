// @vitest-environment node
import { expect, test } from "vitest"
import { buildEmptyTextPdf } from "../../testing/helloPdf"
import { inspectPdfText } from "./extractPdf"
import { slicePdfPages } from "./slicePdf"

test("slicePdfPages ne détache pas le buffer appelant", async () => {
  const bytes = buildEmptyTextPdf(20)
  const sliced = await slicePdfPages(bytes, 0, 10)
  const original = await inspectPdfText(bytes)
  const part = await inspectPdfText(sliced)
  expect(original.totalPages).toBe(20)
  expect(part.totalPages).toBe(10)
})

// @vitest-environment node
import { expect, test, vi } from "vitest"
import { buildEmptyTextPdf, buildHelloPdf } from "../../testing/helloPdf"
import { EXTRACT_ERRORS, ExtractFailure } from "./extractErrors"
import { inspectPdfText } from "./extractPdf"
import { extractPdfForKnowledge, extractPdfStep } from "./extractPdfKnowledge"
import {
  OCR_BATCH_PAGES,
  markdownFromOcrResponse,
  ocrPageBatches,
  ocrPdfWithOpenRouter,
} from "./extractPdfOcr"
import { OPENROUTER_CHAT_URL } from "./openrouter"
import { OPENROUTER_OCR_ENGINE } from "./openRouterOcrModels"

test("un PDF sans calque texte a une page et un texte vide", async () => {
  const layer = await inspectPdfText(buildEmptyTextPdf())
  expect(layer.totalPages).toBe(1)
  expect(layer.text.trim()).toBe("")
})

test("un calque texte vide déclenche l'OCR", async () => {
  let ocrCalls = 0
  const markdown = await extractPdfForKnowledge(buildEmptyTextPdf(), {
    apiKey: "sk-or-test",
    model: "google/gemini-2.5-flash",
    filename: "bootcamp.pdf",
    ocr: async () => {
      ocrCalls += 1
      return "# Bootcamp\n\nBienvenue dans le module 1."
    },
  })
  expect(ocrCalls).toBe(1)
  expect(markdown).toContain("Bootcamp")
})

test("un calque texte présent ne déclenche pas l'OCR", async () => {
  let ocrCalls = 0
  const markdown = await extractPdfForKnowledge(buildHelloPdf("Horaires 9h-18h"), {
    apiKey: "sk-or-test",
    model: "google/gemini-2.5-flash",
    filename: "horaires.pdf",
    ocr: async () => {
      ocrCalls += 1
      return "NE DOIT PAS PARTIR"
    },
  })
  expect(ocrCalls).toBe(0)
  expect(markdown).toContain("Horaires 9h-18h")
})

test("sans clé OpenRouter, un PDF scanné lève l'erreur française", async () => {
  await expect(
    extractPdfForKnowledge(buildEmptyTextPdf(), {
      apiKey: null,
      model: "google/gemini-2.5-flash",
      filename: "scan.pdf",
      ocr: async () => {
        throw new Error("OCR ne doit pas être appelé")
      },
    }),
  ).rejects.toMatchObject({
    name: "ExtractFailure",
    message: EXTRACT_ERRORS.noKey,
  })
})

test("ocrPdfWithOpenRouter poste le moteur mistral-ocr et le PDF en file part", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              annotations: [
                {
                  type: "file",
                  file: { hash: "h", content: [{ type: "text", text: "Lu par OCR." }] },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  )
  vi.stubGlobal("fetch", fetchMock)
  try {
    const text = await ocrPdfWithOpenRouter({
      bytes: buildEmptyTextPdf(),
      filename: "scan.pdf",
      apiKey: "sk-or-test",
      model: "google/gemini-2.5-flash",
    })
    expect(text).toContain("Lu par OCR")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(OPENROUTER_CHAT_URL)
    const body = JSON.parse(String(init.body)) as {
      model: string
      plugins: Array<{ id: string; pdf: { engine: string } }>
      messages: Array<{ content: Array<{ type: string }> }>
    }
    expect(body.model).toBe("google/gemini-2.5-flash")
    expect(body.plugins[0]).toEqual({
      id: "file-parser",
      pdf: { engine: OPENROUTER_OCR_ENGINE },
    })
    expect(body.messages[0]?.content.some((part) => part.type === "file")).toBe(true)
  } finally {
    vi.unstubAllGlobals()
  }
})

test("un PDF de 20 pages est découpé en au moins deux lots, dans l'ordre", () => {
  const batches = ocrPageBatches(20)
  expect(OCR_BATCH_PAGES).toBeGreaterThan(0)
  expect(OCR_BATCH_PAGES).toBeLessThanOrEqual(15)
  expect(batches.length).toBeGreaterThanOrEqual(2)
  expect(batches[0]).toEqual({ start: 0, end: OCR_BATCH_PAGES })
  expect(batches.at(-1)?.end).toBe(20)
})

test("un PDF scanné de 20 pages est OCR par lots, concaténé, sans tropManyPages", async () => {
  const calls: number[] = []
  const markdown = await extractPdfForKnowledge(buildEmptyTextPdf(20), {
    apiKey: "sk-or-test",
    model: "google/gemini-2.5-flash",
    filename: "bootcamp.pdf",
    ocr: async ({ bytes }) => {
      const layer = await inspectPdfText(bytes)
      calls.push(layer.totalPages)
      return `# Lot ${calls.length}\n\n${layer.totalPages} pages dans ce lot.`
    },
  })
  expect(calls.length).toBeGreaterThanOrEqual(2)
  expect(calls.reduce((sum, n) => sum + n, 0)).toBe(20)
  expect(markdown).toContain("Lot 1")
  expect(markdown).toContain("Lot 2")
  expect(markdown.indexOf("Lot 1")).toBeLessThan(markdown.indexOf("Lot 2"))
  expect(markdown).not.toMatch(/15 pages/)
})

test("extractPdfStep n'enchaîne qu'un lot et rend la suite", async () => {
  const first = await extractPdfStep(buildEmptyTextPdf(20), {
    apiKey: "sk-or-test",
    model: "google/gemini-2.5-flash",
    filename: "bootcamp.pdf",
    ocr: async () => "# Module 1",
  })
  expect(first.status).toBe("continue")
  if (first.status !== "continue") throw new Error("attendu continue")
  expect(first.ocrPage).toBe(OCR_BATCH_PAGES)
  expect(first.ocrTotal).toBe(20)
  expect(first.markdown).toContain("Module 1")

  const second = await extractPdfStep(buildEmptyTextPdf(20), {
    apiKey: "sk-or-test",
    model: "google/gemini-2.5-flash",
    filename: "bootcamp.pdf",
    ocrPage: first.ocrPage,
    priorMarkdown: first.markdown,
    ocr: async () => "# Module 2",
  })
  expect(second.status).toBe("done")
  if (second.status !== "done") throw new Error("attendu done")
  expect(second.markdown.indexOf("Module 1")).toBeLessThan(second.markdown.indexOf("Module 2"))
})

test("un lot OCR est retenté une fois avant de réussir", async () => {
  let attempts = 0
  const markdown = await extractPdfForKnowledge(buildEmptyTextPdf(), {
    apiKey: "sk-or-test",
    model: "google/gemini-2.5-flash",
    filename: "scan.pdf",
    ocr: async () => {
      attempts += 1
      if (attempts === 1) throw new ExtractFailure("timeout")
      return "# Ok après retry"
    },
  })
  expect(attempts).toBe(2)
  expect(markdown).toContain("Ok après retry")
})

test("deux échecs d'un lot lèvent l'erreur OCR, pas tropManyPages", async () => {
  let attempts = 0
  await expect(
    extractPdfForKnowledge(buildEmptyTextPdf(), {
      apiKey: "sk-or-test",
      model: "google/gemini-2.5-flash",
      filename: "scan.pdf",
      ocr: async () => {
        attempts += 1
        throw new ExtractFailure("ocr")
      },
    }),
  ).rejects.toMatchObject({
    name: "ExtractFailure",
    message: EXTRACT_ERRORS.ocr,
  })
  expect(attempts).toBe(2)
})

test("si le découpage pdf-lib échoue, l'OCR reçoit le PDF entier", async () => {
  let pagesSent = 0
  const markdown = await extractPdfForKnowledge(buildEmptyTextPdf(20), {
    apiKey: "sk-or-test",
    model: "google/gemini-2.5-flash",
    filename: "bootcamp.pdf",
    slice: async () => {
      throw new ExtractFailure("parse")
    },
    ocr: async ({ bytes }) => {
      const layer = await inspectPdfText(bytes)
      pagesSent = layer.totalPages
      return "# Bootcamp entier"
    },
  })
  expect(pagesSent).toBe(20)
  expect(markdown).toContain("Bootcamp entier")
})

test("markdownFromOcrResponse privilégie les annotations du moteur OCR", () => {
  expect(
    markdownFromOcrResponse({
      choices: [
        {
          message: {
            content: "résumé du modèle, pas le texte",
            annotations: [
              {
                type: "file",
                file: {
                  hash: "abc",
                  content: [{ type: "text", text: "# Page 1\n\nTexte OCR." }],
                },
              },
            ],
          },
        },
      ],
    }),
  ).toContain("Texte OCR")
})

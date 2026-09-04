import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import {
  contentFromChoice,
  extractJsonText,
  parseModelJson,
  repairTrailingCommas,
} from "./parseModelJson"

test("extrait le JSON d'une clôture markdown, même avec un préambule", () => {
  const text = 'Voici le résultat :\n```json\n{"seoTitle":"Ok"}\n```\n'
  expect(extractJsonText(text)).toBe('{"seoTitle":"Ok"}')
})

test("extrait le premier objet JSON noyé dans du texte", () => {
  expect(extractJsonText('Préambule\n{"a":1,"b":2}\nsuite')).toBe('{"a":1,"b":2}')
})

test("répare une virgule finale avant } ou ]", () => {
  expect(JSON.parse(repairTrailingCommas('{"a":1,}'))).toEqual({ a: 1 })
  expect(JSON.parse(repairTrailingCommas('{"xs":[1,2,]}'))).toEqual({ xs: [1, 2] })
})

test("parse un fence, une virgule finale, ou du JSON nu", () => {
  expect(parseModelJson('```json\n{"seoTitle":"A"}\n```')).toEqual({
    seoTitle: "A",
  })
  expect(parseModelJson('{"seoTitle":"B",}')).toEqual({ seoTitle: "B" })
  expect(parseModelJson('{"seoTitle":"C"}')).toEqual({ seoTitle: "C" })
})

test("un texte sans JSON lève OPENROUTER_BAD_RESPONSE", () => {
  try {
    parseModelJson("je ne suis pas du JSON")
    throw new Error("aurait dû lever")
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError)
    expect((error as ConvexError<{ code: string; reason: string }>).data).toEqual({
      code: "OPENROUTER_BAD_RESPONSE",
      reason: "parse",
    })
  }
})

test("ignore un objet de raisonnement avant le JSON utile", () => {
  const text =
    'Je structure ainsi : {"note":"brouillon"}\n{"seoTitle":"Ok","seoDescription":"Desc"}'
  expect(parseModelJson(text)).toEqual({
    seoTitle: "Ok",
    seoDescription: "Desc",
  })
})

test("lit un content déjà objet, un tableau de parts, ou un reasoning", () => {
  expect(
    contentFromChoice({
      choices: [{ message: { content: { seoTitle: "Objet", seo: { title: "Niché" } } } }],
    }),
  ).toContain("seoTitle")
  expect(
    contentFromChoice({
      choices: [
        {
          message: {
            content: [
              { type: "text", text: "```json\n" },
              { type: "text", text: '{"seoTitle":"Parts"}' },
              { type: "text", text: "\n```" },
            ],
          },
        },
      ],
    }),
  ).toContain("seoTitle")
  expect(
    contentFromChoice({
      choices: [
        {
          message: {
            content: null,
            reasoning: 'Voici :\n```json\n{"seoTitle":"Raisonnement"}\n```',
          },
        },
      ],
    }),
  ).toContain("seoTitle")
})

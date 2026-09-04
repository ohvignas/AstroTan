/** @vitest-environment node */
import { createRequire } from "node:module"
import { expect, test } from "vitest"
import { asCtor } from "../convex/lib/yoastCtor"
import { runYoastAnalysis, type YoastEngine } from "../convex/lib/yoastRun"

function loadEngine(): YoastEngine {
  const req = createRequire(import.meta.url)
  const yoast = req("yoastseo") as {
    Paper: unknown
    SeoAssessor: unknown
    ContentAssessor: unknown
    interpreters: YoastEngine["interpreters"]
  }
  const fr = req("yoastseo/build/languageProcessing/languages/fr/Researcher.js")
  return {
    Paper: asCtor(yoast.Paper),
    SeoAssessor: asCtor(yoast.SeoAssessor),
    ContentAssessor: asCtor(yoast.ContentAssessor),
    interpreters: yoast.interpreters,
    FrenchResearcher: asCtor(fr),
  }
}

test("un article FR sans mot-clé ni meta produit des findings SEO et lisibilité", () => {
  const { findings } = runYoastAnalysis({
    bodyHtml: "<h2>Section</h2><p>Un court paragraphe sans mot-clé cible.</p>",
    title: "Titre public de l article",
    seoTitle: "",
    seoDescription: "",
    targetKeyword: "",
    slug: "titre-public",
    webOrigin: "https://exemple.fr",
    engine: loadEngine(),
  })
  expect(findings.length).toBeGreaterThan(0)
  expect(findings.every((f) => f.identifier.length > 0)).toBe(true)
  expect(findings.some((f) => f.identifier === "titleWidth")).toBe(false)
  expect(findings.some((f) => f.family === "seo")).toBe(true)
  expect(findings.some((f) => f.family === "readability")).toBe(true)
  expect(findings.some((f) => f.severity === "good")).toBe(true)
})

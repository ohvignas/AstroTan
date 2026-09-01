/** @vitest-environment node */
import { expect, test } from "vitest"
import { runYoastAnalysis } from "../convex/lib/yoastRun"

test("un article FR sans mot-clé ni meta produit des findings", async () => {
  const { findings } = runYoastAnalysis({
    bodyHtml: "<h2>Section</h2><p>Un court paragraphe sans mot-clé cible.</p>",
    title: "Titre public de l article",
    seoTitle: "",
    seoDescription: "",
    targetKeyword: "",
    slug: "titre-public",
    webOrigin: "https://exemple.fr",
  })
  expect(findings.length).toBeGreaterThan(0)
  expect(findings.every((f) => f.identifier.length > 0)).toBe(true)
  expect(findings.some((f) => f.identifier === "titleWidth")).toBe(false)
})

import { describe, expect, test } from "vitest"
import { geoChecklist } from "./geoChecklist"

const vide = {
  summary: "",
  entities: [] as string[],
  faq: [] as { question: string; answer: string }[],
  noai: false,
  publishedAt: undefined as number | undefined,
}

describe("geoChecklist", () => {
  test("résumé, entités, FAQ manquent sur une fiche vide", () => {
    const items = geoChecklist(vide)
    expect(items.filter((i) => i.status === "missing").map((i) => i.id)).toEqual([
      "summary",
      "entities",
      "faq",
      "schemaFaq",
    ])
  })

  test("noai avertit que le schéma public est coupé", () => {
    const items = geoChecklist({
      ...vide,
      summary: "Deux phrases factuelles.",
      entities: ["Convex"],
      faq: [{ question: "Quoi ?", answer: "Ceci." }],
      noai: true,
      publishedAt: 1,
    })
    expect(items.find((i) => i.id === "noai")?.status).toBe("warn")
    expect(items.find((i) => i.id === "schemaFaq")?.status).toBe("blocked")
    expect(items.find((i) => i.id === "schemaArticle")?.status).toBe("blocked")
  })

  test("Article prêt seulement si publié et !noai", () => {
    const draft = geoChecklist({
      ...vide,
      summary: "Ok.",
      entities: ["A"],
      faq: [{ question: "Q ?", answer: "R." }],
      publishedAt: undefined,
    })
    expect(draft.find((i) => i.id === "schemaArticle")?.status).toBe("pending")
    const live = geoChecklist({
      ...vide,
      summary: "Ok.",
      entities: ["A"],
      faq: [{ question: "Q ?", answer: "R." }],
      publishedAt: 99,
    })
    expect(live.find((i) => i.id === "schemaArticle")?.status).toBe("ok")
    expect(live.find((i) => i.id === "schemaFaq")?.status).toBe("ok")
  })

  test("n'émet ni citations ni auteur", () => {
    const ids = geoChecklist(vide).map((i) => i.id)
    expect(ids).not.toContain("citations")
    expect(ids).not.toContain("author")
  })
})

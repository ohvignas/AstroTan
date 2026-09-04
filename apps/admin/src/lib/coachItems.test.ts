import { describe, expect, test } from "vitest"
import { findingItems, geoItems } from "./coachItems"
import { geoChecklist } from "./geoChecklist"

describe("findingItems", () => {
  const findings = [
    {
      identifier: "keyphraseLength",
      severity: "missing",
      rating: "bad",
      family: "seo",
    },
    {
      identifier: "textLength",
      severity: "improve",
      rating: "ok",
      family: "seo",
    },
    {
      identifier: "passiveVoice",
      severity: "good",
      rating: "good",
      family: "readability",
    },
  ] as const

  test("sépare SEO et lisibilité", () => {
    expect(findingItems([...findings], "seo").map((i) => i.id)).toEqual([
      "keyphraseLength",
      "textLength",
    ])
    expect(findingItems([...findings], "readability").map((i) => i.id)).toEqual([
      "passiveVoice",
    ])
  })

  test("une pastille par sévérité, un libellé FR, pas de score", () => {
    const items = findingItems([...findings], "seo")
    expect(items[0]).toMatchObject({
      tone: "bad",
      title: "Longueur du mot-clé",
    })
    expect(items[1]?.tone).toBe("ok")
    expect(JSON.stringify(items)).not.toContain("/100")
  })

  test("un critère satisfait passe au vert", () => {
    const items = findingItems(
      [
        {
          identifier: "images",
          severity: "good",
          rating: "good",
          family: "seo",
        },
      ],
      "seo",
    )
    expect(items[0]).toMatchObject({ tone: "good", title: "Images" })
  })
})

describe("geoItems", () => {
  test("reprend les items FR de la checklist", () => {
    const items = geoItems(
      geoChecklist({ summary: "", entities: [], faq: [], noai: false }),
    )
    const text = JSON.stringify(items)
    expect(text).toContain("résumé")
    expect(text).not.toContain("citation")
    expect(text).not.toContain("auteur")
    expect(items.find((i) => i.id === "summary")?.tone).toBe("bad")
  })

  test("un résumé renseigné passe au vert", () => {
    const items = geoItems(
      geoChecklist({
        summary: "Deux phrases factuelles.",
        entities: [],
        faq: [],
        noai: false,
      }),
    )
    expect(items.find((i) => i.id === "summary")?.tone).toBe("good")
  })
})

import { describe, expect, test } from "vitest"
import { pointsPourCourbe, prochaineSerie } from "./seoChartSeries"

const LUNDI = Date.UTC(2026, 7, 3, 6, 0, 0)
const LUNDI_SUIVANT = Date.UTC(2026, 7, 10, 6, 0, 0)

describe("pointsPourCourbe", () => {
  test("un point par relevé, rien entre deux lundis", () => {
    const points = pointsPourCourbe(
      [
        { fetchedAt: LUNDI, value: 12 },
        { fetchedAt: LUNDI_SUIVANT, value: 9 },
      ],
      "mois",
    )
    expect(points).toHaveLength(2)
    expect(points.map((p) => p.valeur)).toEqual([12, 9])
    expect(points[0]?.etiquette).toMatch(/3/)
    expect(points[1]?.etiquette).toMatch(/10/)
  })

  test("un seul relevé reste un seul point — pas une courbe inventée", () => {
    expect(pointsPourCourbe([{ fetchedAt: LUNDI, value: 8 }], "semaine")).toHaveLength(1)
  })
})

describe("prochaineSerie", () => {
  test("un clic change la série ; recliquer la pastille SEO active ne ramène pas aux visites", () => {
    expect(prochaineSerie("visites", "position")).toBe("position")
    expect(prochaineSerie("position", "position")).toBe("position")
    expect(prochaineSerie("position", "visites")).toBe("visites")
    expect(prochaineSerie("backlinks", "keywords")).toBe("keywords")
  })
})

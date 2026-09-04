import { describe, expect, test } from "vitest"
import { buildSeo } from "./buildSeo"

const fields = {
  title: "Titre",
  description: "Description",
  canonicalUrl: "https://exemple.fr",
  noindex: false,
}

describe("buildSeo", () => {
  test("un article sans champ partage préserve l'ogImageId encore en base", () => {
    const result = buildSeo({
      existing: { ogImageId: "kg_legacy" },
      fields,
    })
    expect(result.ogImageId).toBe("kg_legacy")
    expect(fields).not.toHaveProperty("ogImageId")
  })

  test("préserve l'ogImageId existant quand le formulaire ne le touche pas", () => {
    const result = buildSeo({
      existing: { ogImageId: "kg01" },
      fields,
    })
    expect(result.ogImageId).toBe("kg01")
  })

  test("omet ogImageId s'il n'a jamais existé", () => {
    const result = buildSeo({ fields })
    expect(result).not.toHaveProperty("ogImageId")
  })

  test("un choix explicite remplace l'existant", () => {
    const result = buildSeo({
      existing: { ogImageId: "kg01" },
      fields: { ...fields, ogImageId: "kg02" },
    })
    expect(result.ogImageId).toBe("kg02")
  })

  test("null retire ogImageId (clear)", () => {
    const result = buildSeo({
      existing: { ogImageId: "kg01" },
      fields: { ...fields, ogImageId: null },
    })
    expect(result).not.toHaveProperty("ogImageId")
  })
})

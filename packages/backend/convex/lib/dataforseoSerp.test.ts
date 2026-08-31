import { describe, expect, test } from "vitest"
import {
  interpretLabs,
  interpretOrganic,
  interpretOverview,
  matchValue,
  normalizeHostPath,
} from "./dataforseoSerp"

describe("normalizeHostPath", () => {
  test("retire schéma, query, hash, slash final", () => {
    expect(normalizeHostPath("https://Exemple.FR/blog/welcome/?utm=1#x")).toEqual({
      host: "exemple.fr",
      path: "/blog/welcome",
    })
    expect(normalizeHostPath("https://exemple.fr/")).toEqual({
      host: "exemple.fr",
      path: "/",
    })
  })
})

describe("matchValue", () => {
  test("hôte + chemin sans schéma ; accueil se termine par /", () => {
    expect(matchValue("exemple.fr", "/")).toBe("exemple.fr/")
    expect(matchValue("exemple.fr", "/blog/welcome")).toBe("exemple.fr/blog/welcome")
  })
})

describe("interpretOrganic", () => {
  const targetUrl = "https://exemple.fr/blog/welcome"
  const ourHost = "exemple.fr"

  test("notre URL → ranked avec rank_absolute", () => {
    expect(
      interpretOrganic({
        items: [
          { type: "organic", url: "https://ailleurs.fr/x", rank_absolute: 3 },
          { type: "organic", url: "https://exemple.fr/blog/welcome", rank_absolute: 7 },
        ],
        targetUrl,
        ourHost,
      }),
    ).toEqual({ status: "ranked", position: 7 })
  })

  test("une autre URL de notre hôte → other_url", () => {
    expect(
      interpretOrganic({
        items: [
          { type: "organic", url: "https://exemple.fr/contact", rank_absolute: 4 },
        ],
        targetUrl,
        ourHost,
      }),
    ).toEqual({ status: "other_url", rankedUrl: "https://exemple.fr/contact" })
  })

  test("aucune URL de notre hôte → out_of_top_100", () => {
    expect(
      interpretOrganic({
        items: [{ type: "organic", url: "https://ailleurs.fr/x", rank_absolute: 1 }],
        targetUrl,
        ourHost,
      }),
    ).toEqual({ status: "out_of_top_100" })
  })

  test("other_url l'emporte sur l'absence de notre URL", () => {
    expect(
      interpretOrganic({
        items: [
          { type: "paid", url: "https://exemple.fr/blog/welcome", rank_absolute: 1 },
          { type: "organic", url: "https://exemple.fr/autre", rank_absolute: 9 },
        ],
        targetUrl,
        ourHost,
      }),
    ).toEqual({ status: "other_url", rankedUrl: "https://exemple.fr/autre" })
  })
})

describe("interpretLabs", () => {
  test("garde keyword, position, url ; jette etv / cpc / search_volume", () => {
    const rows = interpretLabs([
      {
        keyword_data: { keyword: "agence web lyon" },
        ranked_serp_element: {
          serp_item: {
            rank_absolute: 12,
            url: "https://exemple.fr/",
            etv: 999,
            cpc: 4.2,
          },
        },
        search_volume: 5400,
      },
      {
        keyword_data: { keyword: "sans absolute" },
        ranked_serp_element: {
          serp_item: { rank_group: 3, url: "https://exemple.fr/contact" },
        },
      },
    ])
    expect(rows).toEqual([
      { keyword: "agence web lyon", position: 12, url: "https://exemple.fr/" },
      { keyword: "sans absolute", position: 3, url: "https://exemple.fr/contact" },
    ])
    expect(JSON.stringify(rows)).not.toContain("etv")
    expect(JSON.stringify(rows)).not.toContain("5400")
  })
})

describe("interpretOverview", () => {
  test("lit backlinks et referring_domains seulement", () => {
    expect(
      interpretOverview({
        tasks: [
          {
            result: [
              {
                backlinks: 42,
                referring_domains: 7,
                referring_pages: 99,
              },
            ],
          },
        ],
      }),
    ).toEqual({ backlinks: 42, referringDomains: 7 })
  })

  test("corps vide → null", () => {
    expect(interpretOverview({})).toBeNull()
  })
})

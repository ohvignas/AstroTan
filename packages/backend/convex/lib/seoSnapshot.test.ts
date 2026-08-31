import { expect, test } from "vitest"
import { assembleSiteSnapshot } from "./seoSnapshot"

test("sans ranked : moyenne null, pas 0", () => {
  const snap = assembleSiteSnapshot({
    configured: true,
    declaredDomain: "exemple.fr",
    rankedPositions: [],
    keywords: [],
    backlinks: null,
  })
  expect(snap.averagePosition).toBeNull()
  expect(snap.averagePositionPrev).toBeNull()
  expect(snap.backlinks).toBeNull()
})

test("moyenne des ranked ; listes tronquées à 5 ; pages de notre hôte", () => {
  const snap = assembleSiteSnapshot({
    configured: true,
    declaredDomain: "exemple.fr",
    rankedPositions: [
      { position: 4, previousPosition: 10 },
      { position: 8 },
    ],
    keywords: [
      { keyword: "z", position: 9, url: "https://ailleurs.fr/" },
      { keyword: "a", position: 2, url: "https://exemple.fr/contact" },
      { keyword: "b", position: 5, url: "https://exemple.fr/contact" },
      { keyword: "c", position: 3, url: "https://exemple.fr/blog/x" },
    ],
    backlinks: {
      backlinks: 40,
      referringDomains: 6,
      backlinksPrev: 30,
      referringDomainsPrev: 5,
      fetchedAt: 1,
    },
  })
  expect(snap.averagePosition).toBe(6)
  expect(snap.averagePositionPrev).toBe(10)
  expect(snap.keywords.map((k) => k.keyword)).toEqual(["a", "c", "b", "z"])
  expect(snap.rankingPages).toEqual([
    { path: "/contact", position: 2 },
    { path: "/blog/x", position: 3 },
  ])
  expect(snap.backlinks?.value).toBe(40)
  expect(snap.referringDomains?.prev).toBe(5)
})

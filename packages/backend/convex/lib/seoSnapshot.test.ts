import { expect, test } from "vitest"
import { assembleSiteSnapshot } from "./seoSnapshot"

test("sans ranked, avec Labs : moyenne des positions Labs", () => {
  const snap = assembleSiteSnapshot({
    configured: true,
    declaredDomain: "exemple.fr",
    rankedPositions: [],
    keywords: [
      { keyword: "a", position: 4, url: "https://exemple.fr/" },
      { keyword: "b", position: 8, url: "https://exemple.fr/b" },
    ],
    backlinks: null,
  })
  expect(snap.averagePosition).toBe(6)
  expect(snap.keywordCount).toBe(2)
})

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
  expect(snap.keywordCount).toBe(0)
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
      { keyword: "d", position: 20, url: "https://exemple.fr/" },
      { keyword: "e", position: 21, url: "https://exemple.fr/" },
    ],
    backlinks: {
      backlinks: 40,
      referringDomains: 6,
      backlinksPrev: 30,
      referringDomainsPrev: 5,
      fetchedAt: 1,
    },
  })
  expect(snap.averagePosition).toBe(10)
  expect(snap.averagePositionPrev).toBe(10)
  expect(snap.keywords.map((k) => k.keyword)).toEqual(["a", "c", "b", "z", "d"])
  expect(snap.keywordCount).toBe(6)
  expect(snap.rankingPages).toEqual([
    { path: "/contact", position: 2 },
    { path: "/blog/x", position: 3 },
    { path: "/", position: 20 },
  ])
  expect(snap.backlinks?.value).toBe(40)
  expect(snap.referringDomains?.prev).toBe(5)
  expect(snap.fetchedAt).toBe(1)
})

test("fetchedAt est le plus récent Labs/Overview, jamais inventé", () => {
  const vide = assembleSiteSnapshot({
    configured: true,
    declaredDomain: "exemple.fr",
    rankedPositions: [],
    keywords: [],
    backlinks: null,
  })
  expect(vide.fetchedAt).toBeNull()
  const mixte = assembleSiteSnapshot({
    configured: true,
    declaredDomain: "exemple.fr",
    rankedPositions: [],
    keywords: [
      { keyword: "a", position: 2, url: "https://exemple.fr/", fetchedAt: 80 },
    ],
    backlinks: {
      backlinks: 1,
      referringDomains: 1,
      fetchedAt: 50,
    },
  })
  expect(mixte.fetchedAt).toBe(80)
})

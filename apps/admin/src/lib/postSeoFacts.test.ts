import { describe, expect, test } from "vitest"
import { factsForPost } from "./postSeoFacts"
import type { AnalyticsResult } from "@astrotan/backend/convex/analytics"
import type { DocumentRank } from "@astrotan/backend/convex/lib/seoRankState"
import type { SiteSnapshot } from "@astrotan/backend/convex/lib/seoSnapshot"

const rank: DocumentRank = {
  state: "ranked",
  position: 7,
  previousPosition: 12,
  gap: 5,
  canRelever: true,
}

const umami: AnalyticsResult = {
  last7: { pageviews: 128, visitors: 44, pageviewsPrev: 100, visitorsPrev: 40 },
  last30: { pageviews: 903, visitors: 310, pageviewsPrev: 800, visitorsPrev: 280 },
  status: "ok",
}

const snap: SiteSnapshot = {
  configured: true,
  declaredDomain: "exemple.fr",
  averagePosition: 10,
  averagePositionPrev: null,
  backlinks: null,
  referringDomains: null,
  keywords: [{ keyword: "astro", position: 4 }],
  rankingPages: [{ path: "/blog/bonjour", position: 4 }],
  keywordCount: 1,
  fetchedAt: 1,
}

describe("factsForPost", () => {
  test("range, umami et Labs sont trois faits séparés", () => {
    const facts = factsForPost({
      path: "/blog/bonjour",
      targetKeyword: "astro",
      rank,
      umami,
      snapshot: snap,
    })
    expect(facts.map((f) => f.id)).toEqual(["rank", "umami", "labs"])
    expect(facts[0]?.text).toContain("7")
    expect(facts[1]?.text).toContain("128")
    expect(facts[2]?.text).toContain("4")
  })

  test("pas de mot-clé Labs : le dit, n'invente pas un rang", () => {
    const facts = factsForPost({
      path: "/blog/autre",
      targetKeyword: "inconnu",
      rank: { state: "never_ranked", canRelever: true },
      umami: { last7: null, last30: null, status: "not-configured" },
      snapshot: { ...snap, keywords: [], rankingPages: [] },
    })
    expect(facts.find((f) => f.id === "labs")?.text).toMatch(/pas dans le snapshot/i)
    expect(facts.some((f) => f.text.includes("courbe"))).toBe(false)
  })
})

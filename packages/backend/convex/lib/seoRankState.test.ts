import { describe, expect, test } from "vitest"
import {
  RELEVER_THROTTLE_MS,
  canRelever,
  decideRankState,
  documentRank,
} from "./seoRankState"

const ranked = {
  keyword: "agence web lyon",
  status: "ranked" as const,
  position: 7,
  previousPosition: 12,
  fetchedAt: 1_700_000_000_000,
}

describe("decideRankState", () => {
  test("no_keyword l'emporte sur dfs_absent", () => {
    expect(
      decideRankState({
        targetKeyword: "",
        dfsConfigured: false,
        draft: false,
        row: ranked,
      }).state,
    ).toBe("no_keyword")
  })

  test("dfs_absent l'emporte sur ranked", () => {
    expect(
      decideRankState({
        targetKeyword: "agence web lyon",
        dfsConfigured: false,
        draft: false,
        row: ranked,
      }).state,
    ).toBe("dfs_absent")
  })

  test("keyword_changed l'emporte sur ranked", () => {
    expect(
      decideRankState({
        targetKeyword: "nouveau mot",
        dfsConfigured: true,
        draft: false,
        row: ranked,
      }),
    ).toEqual({ state: "keyword_changed", previousKeyword: "agence web lyon" })
  })

  test("other_url l'emporte sur out_of_top_100 via le statut stocké", () => {
    expect(
      decideRankState({
        targetKeyword: "agence web lyon",
        dfsConfigured: true,
        draft: false,
        row: {
          keyword: "agence web lyon",
          status: "other_url",
          rankedUrl: "https://exemple.fr/contact",
          fetchedAt: 1,
        },
      }),
    ).toEqual({
      state: "other_url",
      rankedUrl: "https://exemple.fr/contact",
    })
  })

  test("ranked calcule l'écart (négatif = on a gagné)", () => {
    expect(
      decideRankState({
        targetKeyword: "agence web lyon",
        dfsConfigured: true,
        draft: false,
        row: ranked,
      }),
    ).toEqual({
      state: "ranked",
      position: 7,
      previousPosition: 12,
      gap: 5,
    })
  })

  test("sans ligne → never_ranked", () => {
    expect(
      decideRankState({
        targetKeyword: "agence",
        dfsConfigured: true,
        draft: true,
        row: null,
      }).state,
    ).toBe("never_ranked")
  })
})

describe("canRelever", () => {
  const now = 2_000_000_000_000

  test("interdit no_keyword, dfs_absent, draft", () => {
    expect(canRelever({ state: "no_keyword", draft: false, now })).toBe(false)
    expect(canRelever({ state: "dfs_absent", draft: false, now })).toBe(false)
    expect(canRelever({ state: "never_ranked", draft: true, now })).toBe(false)
  })

  test("throttle : 59 min inactif, 61 min actif", () => {
    expect(
      canRelever({
        state: "ranked",
        draft: false,
        fetchedAt: now - RELEVER_THROTTLE_MS + 60_000,
        now,
      }),
    ).toBe(false)
    expect(
      canRelever({
        state: "keyword_changed",
        draft: false,
        fetchedAt: now - RELEVER_THROTTLE_MS - 60_000,
        now,
      }),
    ).toBe(true)
  })
})

describe("documentRank", () => {
  test("un brouillon déjà relevé montre le rang sans Relever", () => {
    const result = documentRank({
      targetKeyword: "agence web lyon",
      dfsConfigured: true,
      draft: true,
      row: ranked,
      now: ranked.fetchedAt + RELEVER_THROTTLE_MS * 2,
    })
    expect(result.state).toBe("ranked")
    expect(result.canRelever).toBe(false)
  })
})

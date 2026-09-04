import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import { assertSerpLocale, SERP_LIEUX } from "./serpLocale"

function codeDe(fn: () => unknown) {
  try {
    fn()
    throw new Error("aurait dû lever")
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError)
    return (e as ConvexError<{ code: string }>).data
  }
}

test("France par défaut n'est pas écrite — absent = ne pas patcher", () => {
  expect(assertSerpLocale({})).toEqual({})
})

test("un language_code hors [a-z]{2} lève INVALID_SERP_LOCALE", () => {
  expect(codeDe(() => assertSerpLocale({ serpLanguageCode: "FR" })).code).toBe(
    "INVALID_SERP_LOCALE",
  )
  expect(codeDe(() => assertSerpLocale({ serpLanguageCode: "fra" })).code).toBe(
    "INVALID_SERP_LOCALE",
  )
})

test("un location_code ≤ 0 lève INVALID_SERP_LOCALE", () => {
  expect(codeDe(() => assertSerpLocale({ serpLocationCode: 0 })).code).toBe(
    "INVALID_SERP_LOCALE",
  )
  expect(codeDe(() => assertSerpLocale({ serpLocationCode: -1 })).code).toBe(
    "INVALID_SERP_LOCALE",
  )
})

test("fr et 2250 passent ; null efface", () => {
  expect(assertSerpLocale({ serpLocationCode: 2250, serpLanguageCode: "fr" })).toEqual({
    serpLocationCode: 2250,
    serpLanguageCode: "fr",
  })
  expect(
    assertSerpLocale({ serpLocationCode: null, serpLanguageCode: null }),
  ).toEqual({
    serpLocationCode: undefined,
    serpLanguageCode: undefined,
  })
})

test("un location_code hors liste lève INVALID_SERP_LOCALE", () => {
  expect(codeDe(() => assertSerpLocale({ serpLocationCode: 2840 })).code).toBe(
    "INVALID_SERP_LOCALE",
  )
})

test("Belgique et Paris passent", () => {
  expect(assertSerpLocale({ serpLocationCode: 2056 })).toEqual({
    serpLocationCode: 2056,
  })
  expect(assertSerpLocale({ serpLocationCode: 1006094 })).toEqual({
    serpLocationCode: 1006094,
  })
})

test("le catalogue SERP est la liste curated officielle", () => {
  expect(SERP_LIEUX.map((lieu) => lieu.locationCode)).toEqual([
    2250, 2056, 2756, 2442, 2124, 1006094, 1006410, 1006356, 1006219, 1005811,
    1006235, 1006285, 1006359,
  ])
})

import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import { MAX_LEAD_CITY_LENGTH, MAX_LEAD_IP_LENGTH } from "../content"
import { leadGeoPatch, normalizeLeadGeo } from "./leadGeo"

test("sans rien de renseigné, rien à écrire", () => {
  expect(normalizeLeadGeo({})).toEqual({})
  expect(leadGeoPatch({})).toEqual({})
})

test("normalise IP, pays ISO et ville", () => {
  expect(
    normalizeLeadGeo({
      ip: "  203.0.113.42  ",
      country: "fr",
      city: "  Lyon  ",
    }),
  ).toEqual({ ip: "203.0.113.42", country: "FR", city: "Lyon" })
})

test("refuse une IP ou une ville trop longue", () => {
  expect(() => normalizeLeadGeo({ ip: "x".repeat(MAX_LEAD_IP_LENGTH + 1) })).toThrow(ConvexError)
  expect(() => normalizeLeadGeo({ city: "x".repeat(MAX_LEAD_CITY_LENGTH + 1) })).toThrow(
    ConvexError,
  )
})

test("un pays qui n'est pas deux lettres est ignoré", () => {
  expect(normalizeLeadGeo({ country: "France" })).toEqual({})
  expect(normalizeLeadGeo({ country: "F" })).toEqual({})
})

test("une IP locale se conserve, sans inventer de pays", () => {
  expect(normalizeLeadGeo({ ip: "127.0.0.1", country: "XX" })).toEqual({ ip: "127.0.0.1" })
  expect(normalizeLeadGeo({ ip: "::1" })).toEqual({ ip: "::1" })
})

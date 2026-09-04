import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import { statusForCode, jsonError } from "./apiErrors"

test("mappe les codes Convex vers des statuts HTTP", () => {
  expect(statusForCode("UNAUTHENTICATED")).toBe(401)
  expect(statusForCode("FORBIDDEN")).toBe(403)
  expect(statusForCode("NOT_FOUND")).toBe(404)
  expect(statusForCode("SLUG_ALREADY_EXISTS")).toBe(409)
  expect(statusForCode("FIELD_TOO_LONG")).toBe(400)
  expect(statusForCode("INVALID_TITLE")).toBe(400)
  expect(statusForCode("INCONNU")).toBe(500)
})

test("jsonError lit un ConvexError { code }", () => {
  const res = jsonError(new ConvexError({ code: "NOT_FOUND" }))
  expect(res.status).toBe(404)
})

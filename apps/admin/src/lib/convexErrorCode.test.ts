import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import { codeErreurConvex } from "./convexErrorCode"

test("lit data.code d'une ConvexError", () => {
  expect(codeErreurConvex(new ConvexError({ code: "DEMO_FORBIDDEN" }))).toBe(
    "DEMO_FORBIDDEN",
  )
})

test("lit le code dans le message Convex enveloppe", () => {
  expect(
    codeErreurConvex(
      new Error(
        '[CONVEX A(seoRanks:relever)] Server Error Uncaught ConvexError: {"code":"DEMO_FORBIDDEN"}',
      ),
    ),
  ).toBe("DEMO_FORBIDDEN")
})

test("sans code : undefined, pas un faux DEMO", () => {
  expect(codeErreurConvex(new Error("network"))).toBeUndefined()
  expect(codeErreurConvex("nope")).toBeUndefined()
})

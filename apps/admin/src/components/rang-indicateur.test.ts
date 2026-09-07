import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import { phraseRelever, phraseReleverErreur } from "./rang-indicateur"

test("DEMO_FORBIDDEN n'est pas « injoignable »", () => {
  expect(phraseRelever("demo")).toMatch(/bac à sable/i)
  expect(phraseRelever("demo")).not.toMatch(/injoignable/i)
  expect(phraseReleverErreur(new ConvexError({ code: "DEMO_FORBIDDEN" }))).toBe(
    phraseRelever("demo"),
  )
  expect(
    phraseReleverErreur(
      new Error('Uncaught ConvexError: {"code":"DEMO_FORBIDDEN"}'),
    ),
  ).toBe(phraseRelever("demo"))
})

test("une vraie panne réseau reste injoignable", () => {
  expect(phraseRelever("unreachable")).toMatch(/injoignable/i)
  expect(phraseReleverErreur(new Error("fetch failed"))).toBe(
    phraseRelever("unreachable"),
  )
})

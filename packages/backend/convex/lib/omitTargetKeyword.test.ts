import { expect, test } from "vitest"
import { omitTargetKeyword } from "./omitTargetKeyword"

test("retire targetKeyword et laisse le reste", () => {
  expect(
    omitTargetKeyword({ slug: "contact", title: "Contact", targetKeyword: "agence" }),
  ).toEqual({ slug: "contact", title: "Contact" })
  expect(omitTargetKeyword({ slug: "accueil" })).toEqual({ slug: "accueil" })
})

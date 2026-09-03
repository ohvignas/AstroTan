import { ConvexError } from "convex/values"
import { describe, expect, test } from "vitest"
import { describeLeadError } from "./leadErrors"

describe("describeLeadError", () => {
  test("un code connu ne dépend pas du geste", () => {
    const err = new ConvexError({ code: "FORBIDDEN" })
    expect(describeLeadError(err, "move")).toContain("autorité")
    expect(describeLeadError(err, "remove")).toContain("autorité")
  })

  test("un déplacement sans code dit déplacement", () => {
    expect(describeLeadError(new Error("timeout"), "move")).toBe(
      "Le déplacement a échoué : timeout",
    )
    expect(describeLeadError({}, "move")).toBe(
      "Le déplacement a échoué, et le serveur n'a pas dit pourquoi.",
    )
  })

  test("une suppression sans code dit suppression, pas déplacement", () => {
    expect(describeLeadError(new Error("timeout"), "remove")).toBe(
      "La suppression a échoué : timeout",
    )
    expect(describeLeadError({}, "remove")).toBe(
      "La suppression a échoué, et le serveur n'a pas dit pourquoi.",
    )
    expect(describeLeadError(new Error("timeout"), "remove")).not.toContain(
      "déplacement",
    )
  })
})

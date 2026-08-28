import { describe, expect, test } from "vitest"
import { ConvexError } from "convex/values"
import { describeRedirectError } from "./redirectErrors"

function pathAlreadyServed(reason: string, detail: string) {
  return new ConvexError({ code: "PATH_ALREADY_SERVED", reason, detail })
}

describe("describeRedirectError — PATH_ALREADY_SERVED", () => {
  test("never leaks the raw code or the reason token", () => {
    for (const reason of ["route", "page", "post", "reserved"]) {
      const message = describeRedirectError(pathAlreadyServed(reason, "/x"))
      expect(message).not.toContain("PATH_ALREADY_SERVED")
      expect(message).not.toMatch(/\breason\b/)
    }
  })

  test("says a route file answers, and that the dashboard cannot free it", () => {
    const message = describeRedirectError(pathAlreadyServed("route", "/contact"))
    expect(message).toContain("/contact")
    // The distinguishing claim: this path is not the operator's to free.
    expect(message).toMatch(/code du site/i)
    expect(message).toMatch(/ne peut pas être libéré/i)
  })

  test("names the page that already answers, drafts included", () => {
    const message = describeRedirectError(pathAlreadyServed("page", "Tarifs"))
    expect(message).toContain("Tarifs")
    expect(message).toMatch(/brouillon/i)
  })

  test("names the article that already answers", () => {
    const message = describeRedirectError(
      pathAlreadyServed("post", "Lancement du site")
    )
    expect(message).toContain("Lancement du site")
    expect(message).toMatch(/article/i)
  })

  test("says a reserved path belongs to the site itself", () => {
    const message = describeRedirectError(pathAlreadyServed("reserved", "/blog"))
    expect(message).toContain("/blog")
    expect(message).toMatch(/réservé/i)
  })

  test("stays readable when the payload is malformed", () => {
    const message = describeRedirectError(
      new ConvexError({ code: "PATH_ALREADY_SERVED" })
    )
    expect(message).not.toContain("PATH_ALREADY_SERVED")
    expect(message).not.toContain("undefined")
  })
})

describe("describeRedirectError — the re-enable refusal", () => {
  test("names the redirect, what now occupies the path, and that it stayed off", () => {
    const message = describeRedirectError(
      pathAlreadyServed("page", "Tarifs"),
      { action: "enable", from: "tarifs" }
    )
    expect(message).toContain("/tarifs")
    // What now occupies the path — the whole reason this refusal matters.
    expect(message).toContain("Tarifs")
    // The operator must not be left wondering which state the row is in.
    expect(message).toMatch(/reste désactivée/i)
  })

  test("wraps any refusal, not just the interesting one", () => {
    const message = describeRedirectError(new ConvexError({ code: "FORBIDDEN" }), {
      action: "enable",
      from: "x",
    })
    expect(message).toMatch(/reste désactivée/i)
    expect(message).toMatch(/administrateur/i)
  })
})

describe("describeRedirectError — the rest of the vocabulary", () => {
  test("SLUG_HAS_REDIRECT names both ends of the redirect in the way", () => {
    const message = describeRedirectError(
      new ConvexError({ code: "SLUG_HAS_REDIRECT", slug: "tarifs", to: "/offres" })
    )
    expect(message).toContain("/tarifs")
    expect(message).toContain("/offres")
    expect(message).toMatch(/invisible|masqu/i)
  })

  test("UNSAFE_HREF lists what a destination may be", () => {
    const message = describeRedirectError(
      new ConvexError({ code: "UNSAFE_HREF", field: "to" })
    )
    expect(message).toContain("https:")
    expect(message).toContain("mailto:")
  })

  test("REDIRECT_LOOP explains the browser outcome", () => {
    expect(describeRedirectError(new ConvexError({ code: "REDIRECT_LOOP" }))).toMatch(
      /boucle/i
    )
  })

  test("FROM_ALREADY_EXISTS names the path already taken", () => {
    expect(
      describeRedirectError(
        new ConvexError({ code: "FROM_ALREADY_EXISTS", from: "ancien" })
      )
    ).toContain("/ancien")
  })

  test("INVALID_FROM points at the empty input", () => {
    expect(describeRedirectError(new ConvexError({ code: "INVALID_FROM" }))).toMatch(
      /chemin de départ/i
    )
  })

  test("FIELD_TOO_LONG names the field in French and its limit", () => {
    expect(
      describeRedirectError(
        new ConvexError({ code: "FIELD_TOO_LONG", field: "path", max: 2048 })
      )
    ).toBe("Le chemin dépasse la limite autorisée (maximum 2048 caractères).")
  })

  test("FORBIDDEN says who may act, not just that it was refused", () => {
    expect(describeRedirectError(new ConvexError({ code: "FORBIDDEN" }))).toMatch(
      /propriétaire et aux administrateurs/i
    )
  })

  test("falls back to a generic message rather than a blank one", () => {
    expect(describeRedirectError(new Error("boom"))).toBe(
      "Une erreur inattendue est survenue."
    )
    expect(describeRedirectError(new ConvexError({ code: "WAT" }))).toBe(
      "Une erreur inattendue est survenue."
    )
  })
})

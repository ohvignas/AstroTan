import { ConvexError } from "convex/values"
import { describe, expect, test } from "vitest"
import { describePageError } from "./pageErrors"

// Chaque code ici est un refus que le serveur peut rendre. Un code non
// mappé s'affiche « une erreur inattendue est survenue » — refusé, et sans
// savoir pourquoi, ce qui est le pire des deux mondes.

describe("les codes déjà connus", () => {
  test("FIELD_TOO_LONG nomme le champ et sa borne", () => {
    const message = describePageError(
      new ConvexError({ code: "FIELD_TOO_LONG", field: "title", max: 200 }),
    )
    expect(message).toContain("title")
    expect(message).toContain("200")
  })

  test("FIELD_TOO_LONG traduit extraInstructions", () => {
    const message = describePageError(
      new ConvexError({
        code: "FIELD_TOO_LONG",
        field: "extraInstructions",
        max: 500,
      }),
    )
    expect(message).toContain("Instruction complémentaire")
    expect(message).toContain("500")
  })

  test("un code inconnu retombe sur le message générique", () => {
    expect(describePageError(new ConvexError({ code: "QUELQUE_CHOSE" }))).toBe(
      "Une erreur inattendue est survenue.",
    )
  })

  test("une erreur qui n'est pas une ConvexError retombe aussi", () => {
    expect(describePageError(new Error("réseau"))).toBe(
      "Une erreur inattendue est survenue.",
    )
  })
})

describe("les refus OpenRouter", () => {
  test("OPENROUTER_NOT_CONFIGURED pointe vers Réglages → Agent IA & Modèle IA", () => {
    const message = describePageError(
      new ConvexError({ code: "OPENROUTER_NOT_CONFIGURED" }),
    )
    expect(message).toContain("Réglages → Agent IA & Modèle IA")
    expect(message).not.toContain("Réglages → IA.")
    expect(message).not.toBe("Une erreur inattendue est survenue.")
  })

  test("OPENROUTER_REFUSED et UNAVAILABLE ont chacun leur phrase", () => {
    expect(describePageError(new ConvexError({ code: "OPENROUTER_REFUSED" }))).toContain(
      "Agent IA",
    )
    expect(
      describePageError(new ConvexError({ code: "OPENROUTER_UNAVAILABLE" })),
    ).toContain("injoignable")
  })

  test("OPENROUTER_BAD_RESPONSE distingue parse et brouillon vide", () => {
    expect(
      describePageError(new ConvexError({ code: "OPENROUTER_BAD_RESPONSE" })),
    ).toContain("métadonnées")
    expect(
      describePageError(
        new ConvexError({ code: "OPENROUTER_BAD_RESPONSE", reason: "empty" }),
      ),
    ).toContain("n'a pas rempli")
  })

  test("OPENROUTER_BAD_IMAGE pointe vers le modèle d'image", () => {
    expect(describePageError(new ConvexError({ code: "OPENROUTER_BAD_IMAGE" }))).toContain(
      "image",
    )
  })
})


describe("les refus de slug du lot 4", () => {
  test("SLUG_FIXED_BY_ROUTE nomme le fichier à renommer", () => {
    const message = describePageError(
      new ConvexError({
        code: "SLUG_FIXED_BY_ROUTE",
        slug: "contact",
        file: "src/pages/contact.astro",
      }),
    )
    expect(message).toContain("src/pages/contact.astro")
    expect(message).not.toBe("Une erreur inattendue est survenue.")
  })

  test("SLUG_HAS_REDIRECT dit où mène la redirection qui bloque", () => {
    // Sans ça, l'opérateur voyait « une erreur inattendue » alors que la
    // cause est précise et la marche à suivre aussi.
    const message = describePageError(
      new ConvexError({ code: "SLUG_HAS_REDIRECT", slug: "promo", to: "/blog" }),
    )
    expect(message).toContain("/blog")
    expect(message).toContain("Redirections")
  })
})

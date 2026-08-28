import { describe, expect, test } from "vitest"
import { normalizeSlug, slugify } from "./slug"

describe("normalizeSlug — un chemin que quelqu'un a tapé", () => {
  test("retire les slashs et les espaces autour", () => {
    expect(normalizeSlug("  /mon-offre/  ")).toBe("mon-offre")
    expect(normalizeSlug("///a/b///")).toBe("a/b")
  })

  test("préserve la casse", () => {
    // Le slug d'une page est une décision de l'opérateur. La réécrire
    // silencieusement, c'est changer son URL sans le lui dire.
    expect(normalizeSlug("Mon-Offre")).toBe("Mon-Offre")
  })

  test("ne touche pas à l'intérieur du chemin", () => {
    expect(normalizeSlug("a/b/c")).toBe("a/b/c")
  })
})

describe("slugify — un segment dérivé d'un nom", () => {
  test("deux graphies du même nom donnent le même slug", () => {
    // C'est la propriété entière : sans elle, « Astro » et « astro »
    // deviennent deux tags distincts pointant deux URL différentes qui
    // listent les mêmes articles.
    expect(slugify("Astro")).toBe(slugify("astro"))
    expect(slugify("  ASTRO  ")).toBe("astro")
  })

  test("replie les accents sur leur lettre de base", () => {
    expect(slugify("Référencement")).toBe("referencement")
    expect(slugify("Où ça ?")).toBe("ou-ca")
  })

  test("réduit la ponctuation et les espaces à des tirets simples", () => {
    expect(slugify("  L'IA & le No-Code !  ")).toBe("l-ia-le-no-code")
    expect(slugify("a---b")).toBe("a-b")
  })

  test("rend une chaîne vide quand il ne reste rien d'utilisable", () => {
    // L'appelant doit traiter ça comme invalide plutôt que de le stocker :
    // un slug vide entre en collision avec tous les autres slugs vides.
    expect(slugify("!!!")).toBe("")
    expect(slugify("   ")).toBe("")
    expect(slugify("🎉")).toBe("")
  })

  test("laisse passer les chiffres", () => {
    expect(slugify("Top 10 outils")).toBe("top-10-outils")
  })
})

import { describe, expect, test } from "vitest"
import { publicPath, publicUrl } from "./publicPath"

describe("publicPath", () => {
  test("une page ordinaire répond à son slug", () => {
    expect(publicPath("contact", "accueil")).toBe("/contact")
  })

  test("la page d'accueil répond à `/`, jamais à `/<slug>`", () => {
    // L'exception oubliée quatre fois. `/accueil` rend 404 : aucune route
    // ne porte ce nom, c'est `index.astro` qui sert cette page.
    expect(publicPath("accueil", "accueil")).toBe("/")
  })

  test("l'accueil suit le réglage, il n'est pas codé en dur", () => {
    // Un opérateur peut faire pointer `/` sur une autre page depuis
    // l'administration. Coder `accueil` en dur rendait ce choix invisible.
    expect(publicPath("tarifs", "tarifs")).toBe("/")
    expect(publicPath("accueil", "tarifs")).toBe("/accueil")
  })

  test("sans page d'accueil choisie, aucune page n'est l'accueil", () => {
    // Déploiement neuf : `settings.homePageSlug` est absent.
    expect(publicPath("accueil", undefined)).toBe("/accueil")
    expect(publicPath("accueil", null)).toBe("/accueil")
  })
})

describe("publicUrl", () => {
  test("colle l'origine au chemin", () => {
    expect(publicUrl("https://exemple.fr", "contact", "accueil")).toBe(
      "https://exemple.fr/contact",
    )
  })

  test("un slash final dans l'origine ne produit pas de double slash", () => {
    // `https://exemple.fr/` + `/` donnait `https://exemple.fr//`, que
    // certains serveurs redirigent et d'autres non.
    expect(publicUrl("https://exemple.fr/", "accueil", "accueil")).toBe("https://exemple.fr/")
    expect(publicUrl("https://exemple.fr/", "contact", "accueil")).toBe(
      "https://exemple.fr/contact",
    )
  })
})

import { describe, expect, test } from "vitest"
import { isServedByRoute, isUnderDynamicRoute } from "./servedPaths"

// Le manifeste est engendré depuis `apps/web/src/pages` par
// `scripts/generate-served-paths.mjs`. Ces tests portent sur la
// *résolution*, pas sur son contenu — mais ils échoueraient si le
// générateur cessait de produire ce qu'il annonce.

describe("les chemins qu'un fichier de route sert déjà", () => {
  test.each(["/", "/a-propos", "/contact", "/blog"])("%s est servi", (path) => {
    expect(isServedByRoute(path)).toBe(true)
  })

  test("un chemin sous une route dynamique n'est PAS servi par le fichier", () => {
    // `/blog/[slug].astro` résout ce chemin contre la base : il n'est
    // occupé que si l'article existe. Le traiter comme « servi » refuserait
    // la redirection dont un article renommé a le plus besoin — depuis sa
    // propre ancienne URL, qui rend 404 précisément parce qu'il a bougé.
    expect(isServedByRoute("/blog/mon-article")).toBe(false)
    expect(isUnderDynamicRoute("/blog/mon-article")).toBe(true)
  })

  test("mais l'index du blog reste un chemin exact", () => {
    // `blog/index.astro` sert `/blog` lui-même, et rien en base ne peut
    // le libérer.
    expect(isServedByRoute("/blog")).toBe(true)
    expect(isUnderDynamicRoute("/blog")).toBe(false)
  })

  test("un chemin libre ne l'est pas", () => {
    expect(isServedByRoute("/tarifs")).toBe(false)
    expect(isServedByRoute("/ancienne-offre")).toBe(false)
  })

  test("la comparaison passe par le même normaliseur que les slugs", () => {
    // Sinon `/contact/` et `contact` échapperaient à la garde alors qu'ils
    // désignent la page que `contact.astro` sert.
    expect(isServedByRoute("contact")).toBe(true)
    expect(isServedByRoute("/contact/")).toBe(true)
  })

  test("un préfixe ne capture pas un chemin qui commence pareil", () => {
    // `/blogue` n'est pas sous `/blog` : sans la vérification du séparateur
    // la garde refuserait un chemin parfaitement libre.
    expect(isServedByRoute("/blogue")).toBe(false)
  })
})

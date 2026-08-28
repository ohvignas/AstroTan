// Ces bornes existent déjà côté serveur (`convex/content.ts`). Ce fichier
// vérifie qu'on les voit *avant* d'envoyer — sans quoi la sauvegarde
// automatique buterait sur le même refus à chaque pause de frappe.
import {
  MAX_GEO_ENTITIES,
  MAX_GEO_ENTITY_LENGTH,
  MAX_GEO_FAQ_ITEMS,
} from "@astrotan/backend/convex/content"
import { describe, expect, test } from "vitest"
import { describeContentProblem, splitEntities } from "./contentGuards"

const ok = { title: "Tarifs", entities: ["Convex"], faq: [] }

describe("describeContentProblem", () => {
  test("une saisie valide n'empêche rien", () => {
    expect(describeContentProblem(ok)).toBeNull()
  })

  test("un titre vidé est refusé ici plutôt que par le serveur", () => {
    expect(describeContentProblem({ ...ok, title: "   " })).toContain("titre")
  })

  test("trop d'entités", () => {
    const entities = Array.from({ length: MAX_GEO_ENTITIES + 1 }, (_, i) => `e${i}`)
    expect(describeContentProblem({ ...ok, entities })).toContain(
      String(MAX_GEO_ENTITIES)
    )
  })

  test("une entité trop longue — le `maxLength` de l'input borne le total, pas chacune", () => {
    const entities = ["x".repeat(MAX_GEO_ENTITY_LENGTH + 1)]
    expect(describeContentProblem({ ...ok, entities })).toContain(
      String(MAX_GEO_ENTITY_LENGTH)
    )
  })

  test("trop de questions", () => {
    const faq = Array.from({ length: MAX_GEO_FAQ_ITEMS + 1 }, () => ({
      question: "q",
      answer: "r",
    }))
    expect(describeContentProblem({ ...ok, faq })).toContain(
      String(MAX_GEO_FAQ_ITEMS)
    )
  })
})

describe("splitEntities", () => {
  test("découpe, rogne et jette les vides", () => {
    expect(splitEntities(" Convex , Astro ,, ")).toEqual(["Convex", "Astro"])
  })

  test("une chaîne vide ne produit aucune entité", () => {
    expect(splitEntities("")).toEqual([])
  })

  test("aller-retour stable : ce qui est semé depuis la base revient identique", () => {
    // Décisif pour la détection de changement : ouvrir un écran sans rien
    // toucher ne doit pas paraître « sale », donc `join(", ")` puis
    // `splitEntities` doit rendre exactement la liste de départ.
    const stored = ["Convex", "Astro", "AstroTan"]
    expect(splitEntities(stored.join(", "))).toEqual(stored)
  })
})

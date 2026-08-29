import { describe, expect, test } from "vitest"
import { compte, etiquettePoint, nombre, pluriel, poids } from "./dashboardFormat"

/**
 * `fr-FR` sépare les milliers par une espace insécable ÉTROITE (U+202F),
 * pas par une espace ordinaire. C'est voulu — elle empêche le nombre de se
 * couper en fin de ligne — mais elle rend toute comparaison littérale
 * trompeuse : les deux chaînes s'affichent pareil et ne le sont pas.
 */
const espaces = (s: string) => s.replace(/[\u202f\u00a0]/g, " ")

describe("poids", () => {
  test("sous le kilo-octet, reste en octets", () => {
    expect(poids(0)).toBe("0 o")
    expect(espaces(poids(1023))).toBe("1 023 o")
  })

  test("monte d'unité et garde une décimale sous dix", () => {
    // « 1,8 Mo » informe ; « 1 820,4 Ko » demande un calcul mental.
    expect(poids(1_820_412)).toBe("1,7 Mo")
    expect(poids(2048)).toBe("2 Ko")
  })

  test("au-delà de dix, arrondit à l'entier", () => {
    expect(poids(52_428_800)).toBe("50 Mo")
  })
})

describe("compte", () => {
  test("un compte entier se donne tel quel", () => {
    expect(compte({ count: 7, capped: false })).toBe("7")
  })

  test("un compte plafonné se donne comme un minimum", () => {
    // Le plafond existe pour ne pas parcourir une table sans borne. Rendre
    // « 1 000 » sans le dire ferait passer un minimum pour un total.
    expect(espaces(compte({ count: 1000, capped: true }))).toBe("au moins 1 000")
  })
})

describe("nombre", () => {
  test("sépare les milliers", () => {
    // Espace insécable étroite : le nombre ne se coupe pas en fin de ligne.
    expect(espaces(nombre(1_820_412))).toBe("1 820 412")
  })
})

describe("pluriel", () => {
  test("zéro et un restent au singulier, comme en français", () => {
    expect(pluriel(0, "page", "pages")).toBe("page")
    expect(pluriel(1, "page", "pages")).toBe("page")
    expect(pluriel(2, "page", "pages")).toBe("pages")
  })
})

describe("etiquettePoint", () => {
  test("le format suit la granularité", () => {
    expect(etiquettePoint("2026-08-29T00:00:00Z", "jour")).toMatch(/29/)
    expect(etiquettePoint("2026-08-01T00:00:00Z", "mois")).toMatch(/26/)
    expect(etiquettePoint("2026-01-01T00:00:00Z", "annee")).toBe("2026")
  })

  test("lit les seaux en UTC, pas dans le fuseau du navigateur", () => {
    // Les seaux sont demandés en UTC. Les relire en heure locale décalerait
    // l'étiquette d'un jour pour tout visiteur à l'ouest de Greenwich.
    expect(etiquettePoint("2026-08-01T00:00:00Z", "jour")).toMatch(/1/)
  })

  test("une date illisible se rend telle quelle plutôt que « Invalid Date »", () => {
    expect(etiquettePoint("pas-une-date", "jour")).toBe("pas-une-date")
  })
})

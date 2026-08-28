import { describe, expect, test } from "vitest"
import { analyticsScripts } from "./analyticsScripts"

const CONFIGURE = {
  PUBLIC_UMAMI_URL: "https://stats.exemple.fr",
  PUBLIC_UMAMI_WEBSITE_ID: "site-1",
}

describe("analyticsScripts", () => {
  test("sans configuration, aucune requête ne part vers un tiers", () => {
    // L'absence de configuration EST l'interrupteur : un adoptant qui ne
    // veut pas de mesure n'a rien à désactiver.
    expect(analyticsScripts({})).toEqual([])
  })

  test("une moitié de configuration ne produit pas de balise", () => {
    // Une balise à moitié configurée échoue en silence — pire que rien,
    // parce qu'elle donne l'illusion d'une mesure.
    expect(analyticsScripts({ PUBLIC_UMAMI_URL: "https://stats.exemple.fr" })).toEqual([])
    expect(analyticsScripts({ PUBLIC_UMAMI_WEBSITE_ID: "site-1" })).toEqual([])
  })

  test("configurée, elle charge le compteur et lui seul", () => {
    expect(analyticsScripts(CONFIGURE)).toEqual([
      { src: "https://stats.exemple.fr/script.js", websiteId: "site-1" },
    ])
  })

  test("l'enregistrement de session est un SECOND script, pas une option", () => {
    // Constaté dans les réglages d'Umami : activer Replays ou Heatmaps y
    // fait apparaître une deuxième balise, `recorder.js`.
    expect(
      analyticsScripts({ ...CONFIGURE, PUBLIC_UMAMI_RECORDER: "true" }),
    ).toEqual([
      { src: "https://stats.exemple.fr/script.js", websiteId: "site-1" },
      { src: "https://stats.exemple.fr/recorder.js", websiteId: "site-1" },
    ])
  })

  test("l'enregistrement reste éteint tant qu'il n'est pas demandé mot pour mot", () => {
    // Il rejoue ce qu'une personne a fait sur la page, là où le comptage
    // note seulement qu'elle est venue. Une valeur approximative ne doit
    // pas l'allumer par accident.
    for (const valeur of ["", "false", "1", "oui", "TRUE"]) {
      expect(
        analyticsScripts({ ...CONFIGURE, PUBLIC_UMAMI_RECORDER: valeur }),
      ).toHaveLength(1)
    }
  })

  test("un slash final dans l'URL ne produit pas de double slash", () => {
    expect(
      analyticsScripts({ ...CONFIGURE, PUBLIC_UMAMI_URL: "https://stats.exemple.fr/" })[0].src,
    ).toBe("https://stats.exemple.fr/script.js")
  })
})

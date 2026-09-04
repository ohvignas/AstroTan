import { describe, expect, test } from "vitest"
import {
  ETAT_SLUG_INITIAL,
  saisirSlug,
  saisirTitre,
  slugDejaPris,
} from "./slugSync"

describe("le slug suit le titre", () => {
  test("taper le titre remplit le slug", () => {
    const etat = saisirTitre(ETAT_SLUG_INITIAL, "Tarifs 2026")
    expect(etat.slug).toBe("tarifs-2026")
  })

  test("il suit à chaque frappe, pas seulement à la première", () => {
    // Le défaut qu'on ferme ici : un slug semé une fois au premier
    // caractère et jamais remis à jour donnerait « t » pour « Tarifs ».
    const etats = ["T", "Ta", "Tarifs"].reduce<typeof ETAT_SLUG_INITIAL[]>(
      (suite, titre) => [
        ...suite,
        saisirTitre(suite[suite.length - 1] ?? ETAT_SLUG_INITIAL, titre),
      ],
      []
    )
    expect(etats.map((etat) => etat.slug)).toEqual(["t", "ta", "tarifs"])
  })

  test("les accents sont translittérés, jamais recopiés", () => {
    const etat = saisirTitre(ETAT_SLUG_INITIAL, "À propos de nous")
    expect(etat.slug).toBe("a-propos-de-nous")
    // L'assertion d'égalité ci-dessus suffirait ; celle-ci nomme le défaut
    // qu'on refuse, pour qu'une régression se lise sans décoder un diff.
    expect(etat.slug).not.toContain("à")
  })

  test("« Les bases du vibecoding » devient les-bases-du-vibecoding", () => {
    expect(saisirTitre(ETAT_SLUG_INITIAL, "Les bases du vibecoding").slug).toBe(
      "les-bases-du-vibecoding"
    )
  })

  test("la ponctuation et les espaces ne fabriquent pas d'URL cassée", () => {
    expect(saisirTitre(ETAT_SLUG_INITIAL, "  L'IA & le No-Code !  ").slug).toBe(
      "l-ia-le-no-code"
    )
  })
})

describe("le slug cesse de suivre dès qu'on l'édite", () => {
  test("une correction manuelle survit à la frappe suivante dans le titre", () => {
    // Le titre tapé APRÈS la correction donnerait « tarifs-2026 » : c'est
    // ce qui rend ce test discriminant. Une implémentation qui ne romprait
    // jamais le lien le ferait échouer, et une qui le romprait trop tôt
    // ferait échouer le bloc précédent.
    const avant = saisirTitre(ETAT_SLUG_INITIAL, "Tarifs")
    const corrige = saisirSlug(avant, "offres")
    const apres = saisirTitre(corrige, "Tarifs 2026")

    expect(corrige.lie).toBe(false)
    expect(apres.slug).toBe("offres")
    expect(apres.titre).toBe("Tarifs 2026")
  })

  test("la saisie manuelle n'est pas normalisée à la volée", () => {
    // `pages.create` n'applique que `normalizeSlug`, qui préserve la casse.
    // Réécrire ici interdirait un slug que le serveur accepte.
    const etat = saisirSlug(ETAT_SLUG_INITIAL, "Mon Offre")
    expect(etat.slug).toBe("Mon Offre")
  })

  test("vider le slug le remet en laisse", () => {
    const corrige = saisirSlug(saisirTitre(ETAT_SLUG_INITIAL, "Tarifs"), "offres")
    const vide = saisirSlug(corrige, "")
    expect(vide.lie).toBe(true)
    expect(saisirTitre(vide, "Nos tarifs").slug).toBe("nos-tarifs")
  })
})

describe("un slug déjà pris se voit avant le clic", () => {
  const existants = ["contact", "accueil", "mentions-legales"]

  test("reconnaît une page existante", () => {
    expect(slugDejaPris("contact", existants)).toBe(true)
  })

  test("reconnaît la même adresse écrite avec des slashs", () => {
    expect(slugDejaPris("/contact/", existants)).toBe(true)
  })

  test("laisse passer un slug libre", () => {
    expect(slugDejaPris("tarifs", existants)).toBe(false)
  })

  test("ne refuse pas ce que le serveur accepterait", () => {
    // `assertSlugAvailable` compare sur l'index `by_slug`, sensible à la
    // casse. Refuser « Contact » ici bloquerait une création légale.
    expect(slugDejaPris("Contact", existants)).toBe(false)
  })

  test("un champ vide n'est pas une collision", () => {
    expect(slugDejaPris("", existants)).toBe(false)
    expect(slugDejaPris("   ", existants)).toBe(false)
  })
})

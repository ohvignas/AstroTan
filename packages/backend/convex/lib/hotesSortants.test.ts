import { describe, expect, test } from "vitest"
import {
  FENETRE_SORTANTE_MS,
  MAX_SORTANTS,
  noterSortie,
  sortantsValides,
  type HoteSortant,
} from "./hotesSortants"

const T0 = 1_700_000_000_000
const HEURE = 60 * 60 * 1000

describe("noterSortie", () => {
  test("l'hôte remplacé devient sortant, daté de l'instant du changement", () => {
    expect(noterSortie([], "ancien.fr", T0)).toEqual([{ host: "ancien.fr", since: T0 }])
  })

  test("le plus récent passe devant — c'est l'ordre que la lecture suit", () => {
    const un = noterSortie([], "premier.fr", T0)
    const deux = noterSortie(un, "second.fr", T0 + HEURE)
    expect(deux.map((e) => e.host)).toEqual(["second.fr", "premier.fr"])
  })

  test("une CHAÎNE, et non le seul précédent — le cas qui tranche", () => {
    // L'adoptant se trompe de domaine et corrige trois minutes plus tard.
    // Ne garder que le précédent oublierait `origine.fr` — celui qui reçoit
    // encore tout le trafic, et le seul que le routeur route encore, puisque
    // `faute-de-frappe.fr` n'a jamais obtenu de certificat.
    const apresLaFaute = noterSortie([], "origine.fr", T0)
    const apresLaCorrection = noterSortie(apresLaFaute, "faute-de-frappe.fr", T0 + 3 * 60_000)
    expect(apresLaCorrection.map((e) => e.host)).toEqual(["faute-de-frappe.fr", "origine.fr"])
  })

  test("la chaîne est BORNÉE : jamais plus de cinq entrées", () => {
    // `settings` est la table dont la projection publique a déjà coûté une
    // fuite ; un tableau qui grandit sans plafond y est un défaut en soi.
    let liste: HoteSortant[] = []
    for (let i = 0; i < 12; i++) liste = noterSortie(liste, `hote-${i}.fr`, T0 + i * 60_000)
    expect(liste).toHaveLength(MAX_SORTANTS)
    expect(liste[0]?.host).toBe("hote-11.fr")
  })

  test("un aller-retour repart de la date du DERNIER départ", () => {
    // Sinon la fenêtre d'un hôte encore vivant se refermerait sur un
    // souvenir périmé : `a.fr` quitté il y a 70 h, repris, requitté à
    // l'instant, expirerait dans 2 h au lieu de 72.
    const premier = noterSortie([], "a.fr", T0)
    const second = noterSortie(premier, "a.fr", T0 + 70 * HEURE)
    expect(second).toEqual([{ host: "a.fr", since: T0 + 70 * HEURE }])
  })

  test("une valeur qui n'est pas un hôte nu n'entre pas dans la liste", () => {
    // Ce qui sort d'ici finit par autoriser un `Host`. Même règle qu'à la
    // lecture, et pour la même raison.
    expect(noterSortie([], "exemple.fr`) || Host(`pirate.fr", T0)).toEqual([])
    expect(noterSortie([], "https://exemple.fr", T0)).toEqual([])
  })

  test("l'hôte noté est NORMALISÉ, comme le sera celui de la requête", () => {
    expect(noterSortie([], "  ANCIEN.FR.  ", T0)).toEqual([{ host: "ancien.fr", since: T0 }])
  })

  test("l'écriture élague aussi ce qui a expiré", () => {
    const vieux = [{ host: "perime.fr", since: T0 }]
    expect(noterSortie(vieux, "recent.fr", T0 + FENETRE_SORTANTE_MS + 1)).toEqual([
      { host: "recent.fr", since: T0 + FENETRE_SORTANTE_MS + 1 },
    ])
  })

  test("sans hôte à noter, la liste existante est conservée et élaguée", () => {
    const liste = [{ host: "a.fr", since: T0 }]
    expect(noterSortie(liste, null, T0 + HEURE)).toEqual(liste)
    expect(noterSortie(liste, null, T0 + FENETRE_SORTANTE_MS + 1)).toEqual([])
  })
})

describe("sortantsValides", () => {
  test("dans la fenêtre, l'hôte sortant est rendu", () => {
    const liste = [{ host: "ancien.fr", since: T0 }]
    expect(sortantsValides(liste, ["nouveau.fr"], T0 + 71 * HEURE)).toEqual(["ancien.fr"])
  })

  test("passé la fenêtre, il ne l'est plus", () => {
    // Le pendant du test précédent, et la moitié qui BORNE : un hôte
    // reconnu pour toujours resterait reconnu après que l'adoptant a laissé
    // le domaine expirer et que quelqu'un d'autre l'a racheté.
    const liste = [{ host: "ancien.fr", since: T0 }]
    expect(sortantsValides(liste, ["nouveau.fr"], T0 + FENETRE_SORTANTE_MS + 1)).toEqual([])
  })

  test("la bascule tombe exactement sur la fenêtre, pas une heure avant ni après", () => {
    const liste = [{ host: "ancien.fr", since: T0 }]
    expect(sortantsValides(liste, [], T0 + FENETRE_SORTANTE_MS - 1)).toEqual(["ancien.fr"])
    expect(sortantsValides(liste, [], T0 + FENETRE_SORTANTE_MS)).toEqual([])
  })

  test("un hôte redevenu COURANT ne figure pas aussi en sortant", () => {
    const liste = [{ host: "ancien.fr", since: T0 }]
    expect(sortantsValides(liste, ["ancien.fr", "admin.ancien.fr"], T0 + HEURE)).toEqual([])
  })

  test("une valeur douteuse en base ne sort JAMAIS", () => {
    // `settings.update` valide à l'écriture, mais ce n'est pas le seul
    // chemin (migration, `npx convex run`, restauration de sauvegarde), et
    // cette liste décide quel `Host` fait honorer un `x-forwarded-for`.
    const liste = [
      { host: "exemple.fr`) || Host(`pirate.fr", since: T0 },
      { host: "bon.fr", since: T0 },
    ]
    expect(sortantsValides(liste, [], T0 + HEURE)).toEqual(["bon.fr"])
  })

  test("le plus récent d'abord, sans doublon", () => {
    const liste = [
      { host: "vieux.fr", since: T0 },
      { host: "recent.fr", since: T0 + HEURE },
      { host: "recent.fr", since: T0 + HEURE },
    ]
    expect(sortantsValides(liste, [], T0 + 2 * HEURE)).toEqual(["recent.fr", "vieux.fr"])
  })

  test("une liste absente est une liste vide, pas une erreur", () => {
    // L'état de tout déploiement qui n'a jamais changé de domaine — donc
    // de tous, au moment où ce champ apparaît (invariant 6 : le champ est
    // `v.optional()`, déployable seul).
    expect(sortantsValides(undefined, ["exemple.fr"], T0)).toEqual([])
  })
})

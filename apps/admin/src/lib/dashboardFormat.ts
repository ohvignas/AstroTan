// Les formats du tableau de bord, séparés de son affichage.
//
// Un chiffre mal formaté est un chiffre faux : « 1820412 octets » ne se lit
// pas, et « 1 820 412 » lu par quelqu'un qui attend des Mo se lit de
// travers. Ces fonctions sont pures pour que chaque cas — le zéro, le
// plafond, le singulier — soit vérifiable sans rendre un écran.

import type { Periode } from "@astrotan/backend/convex/analytics"

/**
 * Un nombre, en français.
 *
 * `fr-FR` met une espace insécable étroite comme séparateur de milliers.
 * L'écrire à la main avec une espace ordinaire laisserait « 1 820 » se
 * couper en fin de ligne, en plein milieu du nombre.
 */
export function nombre(valeur: number): string {
  return valeur.toLocaleString("fr-FR")
}

/**
 * Un poids de fichiers, lisible.
 *
 * Base 1024 et unités Ko/Mo/Go — celles qu'affiche le système d'un
 * opérateur qui va comparer ce chiffre à ce que son disque lui dit.
 */
export function poids(octets: number): string {
  if (octets < 1024) return `${nombre(octets)} o`
  const unites = ["Ko", "Mo", "Go", "To"]
  let valeur = octets / 1024
  let i = 0
  while (valeur >= 1024 && i < unites.length - 1) {
    valeur /= 1024
    i += 1
  }
  // Une décimale sous 10, aucune au-delà : « 1,8 Mo » informe, « 1 820,4 Ko »
  // demande un calcul mental, et « 1,82345 Mo » fait croire à une précision
  // que la mesure n'a pas.
  const arrondi = valeur < 10 ? Math.round(valeur * 10) / 10 : Math.round(valeur)
  return `${arrondi.toLocaleString("fr-FR")} ${unites[i]}`
}

/**
 * Un compte qui peut avoir été tronqué.
 *
 * `dashboard.overview` s'arrête à mille documents par compteur, pour ne pas
 * parcourir une table sans borne à chaque rendu. Au-delà, le nombre rendu
 * est un MINIMUM, et l'écrire tel quel serait mentir d'autant plus que la
 * médiathèque grossit. « au moins 1 000 » est plus court qu'une note de bas
 * de page et se lit au même endroit que le chiffre.
 */
export function compte(tally: { count: number; capped: boolean }): string {
  return tally.capped ? `au moins ${nombre(tally.count)}` : nombre(tally.count)
}

/** Le pluriel d'un mot, décidé par le nombre qui le précède. */
export function pluriel(valeur: number, singulier: string, pluriel: string): string {
  return valeur > 1 ? pluriel : singulier
}

/** Ce que chaque période recouvre, écrit en toutes lettres. */
export const LIBELLES_PERIODE: Record<Periode, { onglet: string; fenetre: string }> = {
  jour: { onglet: "30 jours", fenetre: "sur les 30 derniers jours" },
  mois: { onglet: "12 mois", fenetre: "sur les 12 derniers mois" },
  annee: { onglet: "5 ans", fenetre: "sur les 5 dernières années" },
}

/**
 * L'étiquette d'un point de la courbe.
 *
 * La granularité décide du format : un jour se nomme par son quantième et
 * son mois, un mois par son mois et son année, une année par elle-même.
 * Afficher « 1 août 2026 » sur douze points de mois remplirait l'axe de
 * « 1 » identiques.
 *
 * `timeZone: "UTC"` n'est pas une négligence : les seaux d'Umami sont
 * demandés en UTC, et les relire dans le fuseau du navigateur décalerait
 * l'étiquette d'un jour pour tout visiteur à l'ouest de Greenwich.
 */
export function etiquettePoint(dateISO: string, periode: Periode): string {
  const d = new Date(dateISO)
  if (Number.isNaN(d.getTime())) return dateISO
  if (periode === "annee") {
    return d.toLocaleDateString("fr-FR", { year: "numeric", timeZone: "UTC" })
  }
  if (periode === "mois") {
    return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" })
  }
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })
}

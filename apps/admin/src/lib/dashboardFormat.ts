// Les formats du tableau de bord, séparés de son affichage.
//
// Un chiffre mal formaté est un chiffre faux : « 1820412 octets » ne se lit
// pas, et « 1 820 412 » lu par quelqu'un qui attend des Mo se lit de
// travers. Ces fonctions sont pures pour que chaque cas — le zéro, le
// plafond, le singulier — soit vérifiable sans rendre un écran.

import type { AnalyticsResult, Periode } from "@astrotan/backend/convex/analytics"

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
  semaine: { onglet: "7 jours", fenetre: "sur les 7 derniers jours" },
  mois: { onglet: "30 jours", fenetre: "sur les 30 derniers jours" },
  // L'onglet dit « 1 an », la fenêtre dit ce qu'on trace vraiment : douze
  // points mensuels. Un seul point annuel ne ferait pas une courbe.
  annee: { onglet: "1 an", fenetre: "sur les 12 derniers mois" },
}

/**
 * L'étiquette d'un point de la courbe.
 *
 * La granularité décide du format : un seau de jour se nomme par son
 * quantième et son mois, un seau de mois par son mois et son année.
 * Afficher « 1 août 2026 » sur douze points de mois remplirait l'axe de
 * « 1 » identiques.
 *
 * `semaine` et `mois` partagent le format : ce sont deux fenêtres au même
 * pas de jour, elles ne diffèrent que par leur longueur.
 *
 * `timeZone: "UTC"` n'est pas une négligence : les seaux d'Umami sont
 * demandés en UTC, et les relire dans le fuseau du navigateur décalerait
 * l'étiquette d'un jour pour tout visiteur à l'ouest de Greenwich.
 */
export function etiquettePoint(dateISO: string, periode: Periode): string {
  const d = new Date(dateISO)
  if (Number.isNaN(d.getTime())) return dateISO
  if (periode === "annee") {
    return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" })
  }
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })
}

/**
 * Pourquoi il n'y a pas de chiffres, quand il n'y en a pas.
 *
 * Un seul exemplaire pour les deux écrans qui les affichent — l'accueil et
 * le panneau d'une page. Ils en portaient chacun une copie, et deux copies
 * d'une phrase divergent : celle de l'accueil promettait encore le retour
 * des chiffres quand celle du panneau ne le faisait plus.
 *
 * Chacune est un ÉTAT du système, jamais une mesure. « Aucune visite » et
 * « on ne sait pas » sont deux choses différentes, et seul le second cas
 * est décrit ici : un zéro affiché sous ces états serait une affirmation
 * que rien ne soutient.
 */
export const LIBELLES_ETAT: Record<
  Exclude<AnalyticsResult["status"], "ok">,
  string
> = {
  "not-configured": "Aucune mesure d'audience n'est configurée.",
  unreachable: "Service de statistiques injoignable.",
  // L'action est gardée, la phrase qui l'introduisait ne l'est pas : sans
  // les deux noms de variables, personne ne sait où aller.
  unauthorized:
    "Identifiants de lecture refusés — vérifiez UMAMI_API_USERNAME et UMAMI_API_PASSWORD.",
}

/**
 * Le même genre d'aveu, pour une partie seule.
 *
 * Umami peut rendre les totaux et rater la série : le service répond, donc
 * aucun des états ci-dessus ne décrit ce qui s'est passé.
 */
export const COURBE_INDISPONIBLE = "Courbe indisponible pour le moment."

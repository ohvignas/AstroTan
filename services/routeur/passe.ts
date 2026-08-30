import { estHoteNu } from "@astrotan/backend/convex/lib/hoteNu"
import type { Hotes } from "@astrotan/backend/convex/routing"
import { composerRoutes } from "./ecrireRoutes"

// UNE passe du service `routeur` : lire les hôtes, comparer, et n'écrire
// que sur un changement réel.
//
// POURQUOI CETTE FONCTION NE TOUCHE NI AU RÉSEAU NI AU DISQUE
//
// Tout ce qu'elle fait passe par `Ports`, injecté. C'est ce qui rend
// éprouvable la partie où une erreur coûte le plus cher — et cette partie
// n'est pas « le fichier est-il bien formé » (`ecrireRoutes.ts` s'en
// charge, seul et pur), mais QUAND on écrit. Les quatre propriétés
// ci-dessous ne s'observent pas autrement qu'en enchaînant des passes.
//
// 1. ANTI-BATTEMENT. Deux lectures successives concordantes avant d'écrire.
//    Le quota Let's Encrypt est de CINQ certificats par domaine et par
//    semaine, ÉCHECS COMPRIS — `docker/.env.example` le documente déjà
//    comme le piège numéro un du déploiement. Un service qui réécrirait à
//    chaque battement le brûlerait en minutes, et l'adoptant passerait une
//    semaine sans certificat, sur un site en avertissement de sécurité.
//
// 2. LES ANCIENS HÔTES SURVIVENT jusqu'à ce que le nouveau serve un
//    certificat valide, puis sont retirés à la passe SUIVANTE. Retirer
//    l'ancien au moment où le nouveau demande son certificat rend
//    l'administration injoignable sur les DEUX domaines si Let's Encrypt
//    échoue — DNS pas encore propagé, quota atteint —, et il ne reste alors
//    que SSH. On ajoute, on vérifie, ensuite seulement on retire.
//
// 3. UN ÉCHEC DE LECTURE NE RÉÉCRIT RIEN. Convex injoignable laisse le
//    routage en place, jamais vidé : sinon une coupure réseau met le site
//    hors ligne. C'est la règle générale de ce plan — échouer FERMÉ.
//
// 4. IL NE FAIT RIEN D'AUTRE. Pas d'API, pas de port exposé, pas de socket
//    Docker. Il lit une query, il écrit un fichier.
//
// D'OÙ VIENT L'ÉTAT « HÔTES PRÉCÉDENTS »
//
// Du FICHIER, relu à chaque passe, et jamais d'une variable de processus.
// Un conteneur redémarre — mise à jour d'image, `compose up`, OOM — et une
// mémoire de processus repartirait alors à vide : elle croirait n'avoir
// aucun ancien hôte à conserver et les retirerait tous du routage, en
// pleine émission de certificat, sans qu'aucun domaine n'ait changé.
// `Memoire` ci-dessous ne porte donc QUE l'anti-battement, dont la perte au
// redémarrage est sans danger : elle ne fait que retarder d'une passe.

/** Ce que `routing.hotes` rend — réexporté pour que l'appelant n'ait pas à
 *  connaître le chemin du backend. */
export type { Hotes }

export type Journal = {
  info: (message: string) => void
  erreur: (message: string) => void
}

/**
 * Tout ce que la passe fait au monde extérieur, et rien de plus. La liste
 * EST la surface du service : quatre verbes, aucun n'écoutant quoi que ce
 * soit.
 */
export type Ports = {
  /** `routing.hotes`, gardée par le secret partagé. Lève si injoignable. */
  lireHotes: () => Promise<Hotes>
  /** Le fichier dynamique tel qu'il est, ou `null` s'il n'existe pas encore. */
  lireRoutes: () => Promise<string | null>
  /** L'écrit, entièrement ou pas du tout. */
  ecrireRoutes: (contenu: string) => Promise<void>
  /**
   * Vrai quand cet hôte sert DÉJÀ un certificat valide.
   *
   * C'est la condition, et la seule, du retrait des anciens hôtes.
   */
  sertUnCertificatValide: (hote: string) => Promise<boolean>
  journal: Journal
}

/**
 * Le souvenir de la lecture précédente, et lui seul.
 *
 * Volontairement pas un état durable : ce qui doit survivre au redémarrage
 * se relit du fichier (voir l'en-tête). Perdre ceci ne coûte qu'une passe.
 */
export type Memoire = { derniere: Hotes | null }

export function memoireNeuve(): Memoire {
  return { derniere: null }
}

/**
 * Ce que la passe a fait — journalisé par l'appelant, et lisible en test.
 *
 * `refus` couvre tout ce qui échoue APRÈS une lecture réussie : le fichier
 * illisible, le volume en lecture seule, un YAML que `composerRoutes`
 * refuse de composer. Il est distinct de `lecture-en-échec` parce que le
 * remède ne l'est pas — l'un se règle sur le VPS, l'autre chez Convex.
 */
export type Issue = "lecture-en-échec" | "confirmation-attendue" | "inchangé" | "écrit" | "refus"

/** Les hôtes que porte un fichier déjà écrit. Le seul format lu est celui
 *  que `composerRoutes` produit : `` Host(`…`) ``, séparés par `||`. */
export function hotesDuFichier(contenu: string | null): string[] {
  if (contenu === null) return []
  return [...new Set([...contenu.matchAll(/Host\(`([^`]*)`\)/g)].map((m) => m[1] ?? ""))]
}

function memesHotes(a: Hotes, b: Hotes): boolean {
  return a.web === b.web && a.admin === b.admin && a.umami === b.umami
}

/** Les hôtes que le routage DOIT porter à cet instant. */
function voulus(hotes: Hotes): string[] {
  return hotes.umami === null ? [hotes.web, hotes.admin] : [hotes.web, hotes.admin, hotes.umami]
}

const enTexte = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/**
 * Une passe. Ne lève jamais : elle rend ce qu'elle a fait.
 *
 * @param memoire mutée sur place — c'est l'anti-battement, et il doit
 * survivre d'une passe à l'autre au sein d'un même processus.
 */
export async function passe(ports: Ports, memoire: Memoire): Promise<Issue> {
  let hotes: Hotes
  try {
    hotes = await ports.lireHotes()
  } catch (cause) {
    // On ne touche PAS au fichier, et on oublie la lecture précédente :
    // « deux lectures SUCCESSIVES » veut dire successives. Écrire ensuite
    // sur la foi d'une lecture antérieure à l'incident, ce serait agir sur
    // un état dont plus rien ne dit qu'il est encore vrai.
    memoire.derniere = null
    ports.journal.erreur(`lecture des hôtes impossible, routage laissé en place — ${enTexte(cause)}`)
    return "lecture-en-échec"
  }

  const precedente = memoire.derniere
  memoire.derniere = hotes
  if (precedente === null || !memesHotes(precedente, hotes)) {
    // Première passe du processus, ou lecture qui ne concorde pas avec la
    // précédente. Dans les deux cas on attend la confirmation : le coût est
    // un intervalle de retard, le coût inverse est une semaine sans
    // certificat.
    return "confirmation-attendue"
  }

  try {
    const contenu = await ports.lireRoutes()
    const attendus = voulus(hotes)

    // Ce que le fichier porte et que les hôtes courants ne portent plus :
    // les ANCIENS. `estHoteNu` les filtre parce que ce fichier vit sur un
    // volume : une valeur douteuse qui y arriverait ne doit ni entrer dans
    // une règle de routage, ni — en faisant lever `composerRoutes` —
    // empêcher pour toujours l'écriture du routage correct.
    const dansLeFichier = hotesDuFichier(contenu)
    const anciens = dansLeFichier.filter((hote) => !attendus.includes(hote) && estHoteNu(hote))
    const illisibles = dansLeFichier.filter((hote) => !attendus.includes(hote) && !estHoteNu(hote))
    if (illisibles.length > 0) {
      ports.journal.erreur(`hôtes écartés du fichier existant, non conformes : ${illisibles.join(", ")}`)
    }

    let aGarder = anciens
    if (anciens.length > 0) {
      // La sonde. Elle ne tourne que pendant une transition — jamais en
      // régime établi, où `anciens` est vide.
      //
      // Une sonde qui LÈVE vaut « pas de certificat » : si l'on ne sait pas
      // que le nouvel hôte est joignable, on ne retire pas celui qui l'est.
      const verdicts = await Promise.all(
        attendus.map((hote) => ports.sertUnCertificatValide(hote).catch(() => false)),
      )
      if (verdicts.every(Boolean)) {
        ports.journal.info(
          `les nouveaux hôtes servent un certificat valide — retrait de ${anciens.join(", ")}`,
        )
        aGarder = []
      }
    }

    const nouveau = composerRoutes(hotes, aGarder)
    // L'égalité au texte près est ce qui protège le quota : sans elle,
    // chaque tour de boucle toucherait le fichier, Traefik rechargerait, et
    // les certificats se redemanderaient sans qu'aucun domaine n'ait bougé.
    if (nouveau === contenu) return "inchangé"

    await ports.ecrireRoutes(nouveau)
    ports.journal.info(`routage écrit : ${[...attendus, ...aGarder].join(", ")}`)
    return "écrit"
  } catch (cause) {
    // Le routage en place n'est pas touché — `ecrireRoutes` remplace le
    // fichier d'un seul geste ou pas du tout. On repart d'une confirmation
    // à acquérir, pour la même raison qu'à la lecture.
    memoire.derniere = null
    ports.journal.erreur(`routage laissé en place — ${enTexte(cause)}`)
    return "refus"
  }
}

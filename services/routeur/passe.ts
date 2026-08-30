import { estHoteNu } from "@astrotan/backend/convex/lib/hoteNu"
import { MAX_SORTANTS } from "@astrotan/backend/convex/lib/hotesSortants"
import type { Hotes } from "@astrotan/backend/convex/routing"
import { composerRoutes, serviceDeLAncienHote } from "./ecrireRoutes"

// UNE passe du service `routeur` : lire les hôtes, comparer, et n'écrire
// que sur un changement réel.
//
// POURQUOI CETTE FONCTION NE TOUCHE NI AU RÉSEAU NI AU DISQUE
//
// Tout ce qu'elle fait passe par `Ports`, injecté. C'est ce qui rend
// éprouvable la partie où une erreur coûte le plus cher — et cette partie
// n'est pas « le fichier est-il bien formé » (`ecrireRoutes.ts` s'en
// charge, seul et pur), mais QUAND on écrit. Les cinq propriétés
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
// 3. UN ÉCHEC DE LECTURE NE RÉÉCRIT RIEN — tant qu'il y a quelque chose à
//    ne pas réécrire. Convex injoignable laisse le routage en place, jamais
//    vidé : sinon une coupure réseau met le site hors ligne. C'est la règle
//    générale de ce plan — échouer FERMÉ.
//
//    SA MOITIÉ MANQUANTE, ET ELLE A COÛTÉ UNE PANNE TOTALE. « Ne rien
//    écrire » a deux sens, et le premier jet n'en avait raisonné qu'un.
//    Quand le fichier existe, ne rien écrire fige le routage : c'est bien
//    l'échec fermé. Quand il n'existe pas ENCORE — c'est-à-dire au premier
//    démarrage de cette version, celui-là même qui a retiré les labels
//    `traefik.http.routers.*.rule` du compose —, ne rien écrire laisse
//    Traefik SANS AUCUN ROUTEUR : site et administration en 404 permanent,
//    sans issue par l'interface. Ce n'est pas un échec fermé, c'est une
//    panne totale, et trois entrées ordinaires y mènent (`ROUTING_SECRET`
//    absent du déploiement Convex, divergent, ou `WEB_DOMAIN` absent de
//    l'environnement CONVEX). Le compose anticipait une fenêtre vide en la
//    croyant longue de deux passes ; elle est PERMANENTE dès que la query
//    refuse.
//
//    D'où le point 5.
//
// 4. IL NE FAIT RIEN D'AUTRE. Pas d'API, pas de port exposé, pas de socket
//    Docker. Il lit une query, il écrit un fichier.
//
// 5. IL EXISTE TOUJOURS UN ROUTAGE. Quand la lecture échoue ET qu'aucun
//    routage n'est en place, la passe en compose un depuis l'ENVIRONNEMENT
//    DU CONTENEUR (`hotesDeSecours`) — la même information qui alimentait
//    les labels avant, posée par le même `.env` du VPS. Elle ne le fait
//    QUE dans ce cas : un fichier déjà écrit n'est jamais remplacé par le
//    repli, sans quoi une panne Convex ramènerait le domaine d'origine et
//    déferait un changement de domaine réussi.
//
//    Le coût en quota Let's Encrypt est borné par construction : après
//    cette écriture le fichier existe, donc la branche ne se reprend plus.
//    Elle n'a pas besoin de l'anti-battement du point 1 — `process.env` ne
//    bat pas, il est figé pour la vie du conteneur — et elle ne PEUT pas
//    l'utiliser : une lecture en échec remet `memoire.derniere` à `null`,
//    donc deux lectures concordantes n'arriveraient jamais.
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
 * EST la surface du service : cinq verbes, aucun n'écoutant quoi que ce
 * soit.
 */
export type Ports = {
  /** `routing.hotes`, gardée par le secret partagé. Lève si injoignable. */
  lireHotes: () => Promise<Hotes>
  /**
   * Les hôtes que porte l'ENVIRONNEMENT DU CONTENEUR, ou `null` s'il n'en
   * porte aucun d'exploitable.
   *
   * Synchrone et sans `Promise` exprès : ce n'est ni un appel réseau ni une
   * lecture de disque, seulement du `process.env` — c'est ce qui en fait un
   * recours valable quand tout le reste est injoignable.
   *
   * Voir le point 5 de l'en-tête pour ce qui l'autorise à écrire, et
   * surtout pour ce qui le lui interdit.
   */
  hotesDeSecours: () => Hotes | null
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
 *
 * `routage-de-secours` est le point 5 : la lecture a échoué ET rien
 * n'était routé, donc le repli de l'environnement du conteneur a été
 * écrit. C'est une issue à part, et pas un `écrit`, parce qu'elle dit
 * quelque chose que `écrit` ne dit pas — le site est debout, mais sur des
 * hôtes que `routing.hotes` n'a jamais confirmés.
 */
export type Issue =
  | "lecture-en-échec"
  | "routage-de-secours"
  | "confirmation-attendue"
  | "inchangé"
  | "écrit"
  | "refus"

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
 * Le dernier recours, et seulement quand il n'existe AUCUN routage.
 *
 * Appelée sur le seul chemin où la question se pose : `lireHotes` vient de
 * lever. Voir le point 5 de l'en-tête pour le raisonnement ; ce qui suit
 * n'en est que la mise en œuvre.
 */
async function routageDeSecours(ports: Ports): Promise<Issue> {
  let contenu: string | null
  try {
    contenu = await ports.lireRoutes()
  } catch (cause) {
    // On ne SAIT pas ce que le volume porte. Écrire par-dessus une lecture
    // en échec (droits, volume non monté) risquerait d'effacer un routage
    // correct pour lui substituer le repli — exactement ce que le point 5
    // s'interdit. On journalise et on laisse.
    ports.journal.erreur(`routage existant illisible, rien écrit — ${enTexte(cause)}`)
    return "lecture-en-échec"
  }

  // Le fichier peut exister sans porter aucune route (tronqué, vidé à la
  // main). C'est indiscernable de son absence du point de vue de Traefik,
  // qui n'a alors pas davantage de routeur : la condition est donc « aucun
  // hôte routé », pas « aucun fichier ».
  if (hotesDuFichier(contenu).length > 0) return "lecture-en-échec"

  const secours = ports.hotesDeSecours()
  if (secours === null) {
    ports.journal.erreur(
      "AUCUN routage en place et aucun hôte dans l'environnement du conteneur : " +
        "Traefik n'a aucun routeur et tout répond 404. Poser WEB_DOMAIN dans le `.env` du VPS, " +
        "puis `docker compose up -d routeur` — docker/README.md §6 et §14.",
    )
    return "lecture-en-échec"
  }

  try {
    // Aucun ancien hôte : il n'y avait rien à conserver, c'est la
    // définition même de la branche.
    await ports.ecrireRoutes(composerRoutes(secours, []))
  } catch (cause) {
    ports.journal.erreur(`routage de secours impossible à écrire — ${enTexte(cause)}`)
    return "refus"
  }

  // En `erreur` et non en `info` : le site est debout, mais sur des hôtes
  // que `routing.hotes` n'a jamais confirmés, et le domaine déclaré depuis
  // l'administration reste sans effet tant que la query refuse. C'est une
  // situation à réparer, pas un régime établi.
  ports.journal.erreur(
    `AUCUN routage n'était en place : routage de SECOURS écrit depuis l'environnement du ` +
      `conteneur (${voulus(secours).join(", ")}). Le site répond, mais le domaine déclaré ` +
      `depuis l'administration restera sans effet tant que la lecture échouera.`,
  )
  return "routage-de-secours"
}

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
    // On oublie la lecture précédente : « deux lectures SUCCESSIVES » veut
    // dire successives. Écrire ensuite sur la foi d'une lecture antérieure
    // à l'incident, ce serait agir sur un état dont plus rien ne dit qu'il
    // est encore vrai.
    memoire.derniere = null
    ports.journal.erreur(`lecture des hôtes impossible — ${enTexte(cause)}`)
    // Le routage en place n'est pas touché. Mais s'il n'y en a AUCUN, ne
    // rien faire n'est pas échouer fermé, c'est laisser Traefik sans le
    // moindre routeur — point 5 de l'en-tête.
    return routageDeSecours(ports)
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
    const illisibles = dansLeFichier.filter((hote) => !attendus.includes(hote) && !estHoteNu(hote))
    if (illisibles.length > 0) {
      ports.journal.erreur(`hôtes écartés du fichier existant, non conformes : ${illisibles.join(", ")}`)
    }

    // Bornée, comme la chaîne des origines sortantes (`MAX_SORTANTS`,
    // `lib/hotesSortants.ts`) — et pour la même raison de quota. Rien ici
    // ne borne autrement le nombre d'ANCIENS conservés : tant qu'un domaine
    // fraîchement déclaré n'obtient pas de certificat, la passe SUIVANTE
    // qui change encore de domaine reclasse le dernier `attendus` en
    // `ancien` et l'ajoute à ce qui restait déjà — sans plafond, chaque
    // tentative de plus ajoute un `Host()` de plus par service, et Traefik
    // en redemande un certificat à chaque tentative : c'est le quota Let's
    // Encrypt qui trinque, indéfiniment.
    //
    // Bornée PAR SERVICE (`serviceDeLAncienHote`, `ecrireRoutes.ts`), pas
    // globalement : un plafond global sur la liste à plat piocherait selon
    // l'ordre du fichier — celui de `SERVICES`, `web` avant `admin` avant
    // `umami` — et pourrait épuiser le quota sur les seuls anciens hôtes
    // `web`, en laissant tomber le dernier ancien hôte `admin` encore
    // joignable. Ce serait précisément le dashboard verrouillé que le
    // point 2 de l'en-tête existe pour empêcher.
    const parService = new Map<string, string[]>()
    for (const hote of dansLeFichier) {
      if (attendus.includes(hote) || !estHoteNu(hote)) continue
      const service = serviceDeLAncienHote(hote, hotes)
      const liste = parService.get(service) ?? []
      if (liste.length < MAX_SORTANTS) liste.push(hote)
      parService.set(service, liste)
    }
    const anciens = [...parService.values()].flat()

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

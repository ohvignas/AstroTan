import { normaliserHote } from "./hoteNu"

// Les hôtes SORTANTS : ceux d'avant le dernier changement de domaine, tant
// qu'ils peuvent encore recevoir du trafic.
//
// ── LA LACUNE QUE CE MODULE FERME ──────────────────────────────────────
//
// Tout le lot « changer de domaine depuis le dashboard » applique un seul
// principe : ajouter, vérifier, puis seulement retirer. Le service
// `routeur` garde les anciens hôtes ROUTÉS jusqu'à ce que le nouveau serve
// un certificat valide ; `trustedOrigins` ajoute la nouvelle origine sans
// retirer l'ancienne. C'est ce qui empêche un changement de domaine de
// verrouiller l'adoptant hors de son propre dashboard.
//
// La validation d'hôte du site public ne l'appliquait qu'à moitié.
// `routing.hotes` ne rendait que les hôtes COURANTS, si bien qu'un
// visiteur arrivant encore sur l'ancien domaine — DNS pas encore propagé,
// résolveur qui garde son cache — n'était pas reconnu : son
// `x-forwarded-for` n'était pas honoré, et il partageait un seau de
// limitation de débit avec tous les autres retardataires. Transitoire, et
// FERMÉ, donc pas une faille — mais une dégradation silencieuse pendant
// exactement la fenêtre où l'adoptant est le plus fragile.
//
// ── CE QU'UN HÔTE SORTANT AUTORISE, ET RIEN DE PLUS ────────────────────
//
// Il est reconnu pour HONORER `x-forwarded-for`, un point c'est tout. Ce
// n'est pas une autorisation d'accès — Traefik décide seul de ce qu'il
// route —, ce n'est pas une origine de confiance pour l'authentification
// (`trustedOrigins` et `baseURL` sortent de `lib/origines.ts`, qui ne lit
// jamais ce module), et ce n'est pas une origine de lien d'email. La
// question à laquelle un hôte sortant répond est la seule suivante :
// « ce visiteur vient-il bien par notre proxy, son adresse est-elle
// fiable ? »
//
// ── D'OÙ VIENT LA SOURCE DE VÉRITÉ, ET POURQUOI PAS LE FICHIER ─────────
//
// Le service `routeur` relit SES anciens hôtes depuis le fichier qu'il a
// écrit (`services/routeur/passe.ts`), parce que lui seul l'écrit et qu'un
// état de processus disparaîtrait au redémarrage. Convex ne voit pas ce
// fichier, et le lui faire remonter demanderait une mutation appelée par
// le routeur — donc un second chemin d'écriture sur `settings`, gardé par
// le même secret partagé, pour une information que la base connaît déjà :
// elle sait quel domaine était déclaré avant, puisque c'est elle qui l'a
// remplacé.
//
// La ligne `settings` retient donc les hôtes web sortants avec la date de
// leur sortie, `settings.update` les note, et `routing.hotes` les filtre à
// la lecture. Les deux côtés partagent CE fichier, et c'est la raison
// d'être du module : une fenêtre appliquée à l'écriture mais pas à la
// lecture — ou l'inverse — serait un désaccord invisible.

/** Un hôte web qui n'est plus le courant, et la date à laquelle il a cessé de l'être. */
export type HoteSortant = {
  /** Un hôte NU, normalisé — jamais la valeur brute d'un formulaire. */
  host: string
  /** `Date.now()` au moment du changement de domaine. */
  since: number
}

/**
 * Combien de temps un hôte reste sortant : **72 heures**.
 *
 * Le choix se justifie des deux côtés, et les deux comptent.
 *
 * **Pourquoi pas moins.** Ce que la fenêtre doit couvrir, c'est la survie
 * des ANCIENS enregistrements DNS dans les caches. Un résolveur garde un
 * enregistrement A jusqu'à l'expiration du TTL que la zone publiait AVANT
 * le changement — une heure chez la plupart des registrars, jusqu'à
 * vingt-quatre chez certains, et davantage chez les résolveurs qui
 * arrondissent à leur avantage ; c'est la raison du « comptez 48 heures »
 * que les registrars affichent eux-mêmes. Trois jours, c'est ce chiffre
 * plus une marge entière, et c'est un week-end complet — un domaine
 * changé le vendredi soir reste couvert le lundi matin.
 *
 * **Pourquoi pas « toujours ».** Une valeur qui n'expire jamais est une
 * valeur que personne ne revient regarder : l'ancien domaine d'un
 * adoptant resterait reconnu des années, y compris après qu'il l'a laissé
 * expirer et que quelqu'un d'autre l'a racheté. Passé trois jours,
 * l'adoptant n'est plus dans la fenêtre fragile — le nouveau domaine sert
 * son certificat depuis longtemps, et l'ancien n'est même plus routé.
 *
 * **Pourquoi elle est bien plus longue que la rétention du routeur.**
 * Le service `routeur` retire les anciens hôtes du routage dès que les
 * nouveaux servent un certificat valide, soit des minutes. Cette
 * fenêtre-ci est délibérément le côté généreux de la paire : reconnaître
 * un hôte sortant est une confiance ÉTROITE (honorer un en-tête), tandis
 * que le retirer trop tôt rouvre exactement la dégradation qu'on ferme.
 * Le cas où les deux divergent le plus est connu et documenté : sur le CA
 * de STAGING de Let's Encrypt, aucun certificat n'est reconnu, donc le
 * routeur ne retire JAMAIS les anciens hôtes — ils resteront routés après
 * l'expiration de cette fenêtre, et cesseront alors d'être reconnus. La
 * dégradation retombe sur le comportement d'avant ce module, c'est-à-dire
 * fermée.
 */
export const FENETRE_SORTANTE_MS = 72 * 60 * 60 * 1000

/**
 * Combien d'hôtes sortants sont retenus à la fois : **cinq**.
 *
 * C'est la réponse à « garde-t-on une chaîne, ou seulement le précédent ».
 * Une CHAÎNE, bornée, et le cas qui tranche est le plus banal de tous :
 * l'adoptant se trompe de domaine, s'en aperçoit en trois minutes, et
 * corrige. Ne garder que le précédent ferait alors oublier le domaine
 * D'ORIGINE — celui qui reçoit encore tout le trafic, et le seul que le
 * routeur route encore, puisque le domaine erroné n'a jamais obtenu de
 * certificat. On aurait perdu exactement l'hôte qui compte.
 *
 * Bornée, parce qu'un tableau sans plafond dans `settings` grandit sans
 * que rien ne le regarde, dans la table dont la projection publique a déjà
 * coûté une fuite. Cinq est plus que ce dont une correction de correction
 * a jamais besoin, et l'élagage par la fenêtre fait le reste.
 */
export const MAX_SORTANTS = 5

/** Ce qui reste dans la fenêtre, le plus récent d'abord. */
function dansLaFenetre(anciens: readonly HoteSortant[], maintenant: number): HoteSortant[] {
  return [...anciens]
    .filter((entree) => maintenant - entree.since < FENETRE_SORTANTE_MS)
    .sort((a, b) => b.since - a.since)
}

/**
 * Note qu'un hôte vient de cesser d'être le courant.
 *
 * Appelée par `settings.update`, à l'écriture — le seul endroit qui sache
 * ce que valait l'hôte web AVANT le changement.
 *
 * @param anciens la liste telle qu'elle est en base, non validée.
 * @param sortant l'hôte web qui vient d'être remplacé, ou `null` s'il n'y
 * en avait pas (un déploiement sans `WEB_DOMAIN` et sans domaine déclaré).
 * @param maintenant `Date.now()`, injecté pour que le test décide du temps.
 */
export function noterSortie(
  anciens: readonly HoteSortant[] | undefined,
  sortant: string | null,
  maintenant: number,
): HoteSortant[] {
  const retenus = dansLaFenetre(anciens ?? [], maintenant)
  const hote = sortant === null ? null : normaliserHote(sortant)
  // Un hôte douteux ne rentre pas — même règle qu'à la lecture, et pour la
  // même raison : ce qui sort d'ici finit par autoriser un `Host`.
  if (hote === null) return retenus.slice(0, MAX_SORTANTS)

  // La ligne existante du même hôte disparaît : la sortie la plus récente
  // l'emporte. Un aller-retour A → B → A → B doit repartir de la date du
  // dernier départ de A, pas de la première — sinon la fenêtre d'un hôte
  // encore vivant se referme sur un souvenir périmé.
  return [{ host: hote, since: maintenant }, ...retenus.filter((e) => e.host !== hote)].slice(
    0,
    MAX_SORTANTS,
  )
}

/**
 * Les hôtes sortants encore valables, à la lecture.
 *
 * Revalidés ici comme partout ailleurs : `settings.update` n'est pas le
 * seul chemin qui écrit dans cette table (migration, `npx convex run`,
 * restauration de sauvegarde), et cette liste finit par décider quel
 * `Host` fait honorer un `x-forwarded-for`.
 *
 * @param courants les hôtes actuellement en vigueur. Ils sont RETIRÉS du
 * résultat : un domaine repris après avoir été quitté n'a pas à figurer
 * deux fois, et le lecteur n'a pas à dédoublonner à sa place.
 */
export function sortantsValides(
  anciens: readonly HoteSortant[] | undefined,
  courants: readonly string[],
  maintenant: number,
): string[] {
  const exclus = new Set(courants)
  const vus = new Set<string>()
  const sortants: string[] = []
  for (const entree of dansLaFenetre(anciens ?? [], maintenant)) {
    const hote = normaliserHote(entree.host)
    if (hote === null || exclus.has(hote) || vus.has(hote)) continue
    vus.add(hote)
    sortants.push(hote)
    if (sortants.length === MAX_SORTANTS) break
  }
  return sortants
}

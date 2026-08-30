// L'adresse du visiteur, derrière le reverse proxy — et la seule chose qui
// rende les deux limiteurs de débit du site honnêtes.
//
// ── LE DÉFAUT QUE CE FICHIER FERME ─────────────────────────────────────
//
// `/api/contact` et `/api/consent` limitent le débit par visiteur, et la
// clé de ce compteur est l'empreinte de son adresse. Derrière Traefik, le
// conteneur `web` reçoit toutes les requêtes depuis UNE seule adresse :
// celle du conteneur Traefik. Sans rien de plus, `clientAddress` vaut donc
// la MÊME chose pour tout Internet, et les deux limiteurs n'ont qu'un seau
// pour l'ensemble des visiteurs — cinq messages de contact par heure pour
// la planète, puis `RATE_LIMITED` pour tout le monde ; vingt
// enregistrements de consentement par heure, puis plus aucune preuve
// écrite, en silence, pendant que `/confidentialite` annonce « pouvoir
// prouver le consentement ».
//
// ── POURQUOI ON NE LIT PAS `x-forwarded-for` TOUT COURT ────────────────
//
// Parce que c'est un en-tête que le CLIENT peut poser. Le lire sans
// condition transformerait une limite de débit en outil d'usurpation :
// n'importe qui pourrait s'attribuer l'adresse de n'importe qui — donc
// consommer le quota d'un autre — ou s'en fabriquer une neuve à chaque
// requête, et n'être jamais limité.
//
// La condition, et la seule, est d'avoir RECONNU l'hôte de la requête
// comme l'un des nôtres. C'est cette reconnaissance qui distingue « ce
// proxy est le nôtre » de « quelqu'un prétend être derrière un proxy ».
//
// ── CE QUI A CHANGÉ : LA LISTE VIENT DU RUNTIME ────────────────────────
//
// Cette reconnaissance était celle d'Astro (`security.allowedDomains`,
// posée dans `astro.config.ts`). Elle marchait, et elle avait un défaut de
// nature : `astro.config.ts` est lu pendant `astro build`, donc la liste
// était figée dans l'image. Changer de domaine imposait de RECONSTRUIRE,
// ce que l'écran `/settings/domaine` ne peut pas faire.
//
// La liste vient donc maintenant de `routing.hotes` — la même query que le
// service `routeur` interroge pour écrire le routage de Traefik, donc la
// même source de vérité que le routage lui-même — et `astro.config.ts` ne
// porte plus aucun domaine.
//
// ── ET L'ÉCHEC RESTE FERMÉ ─────────────────────────────────────────────
//
// Un hôte inconnu ⇒ on n'honore pas l'en-tête. Convex injoignable sur un
// cache froid ⇒ aucun hôte connu, donc on n'honore pas davantage. Le pire
// cas reste exactement le comportement d'avant : l'adresse de la socket,
// jamais une confiance mal placée.
//
// La seule exception est le cas symétrique, et elle est délibérée : une
// panne de lecture APRÈS une lecture réussie conserve les hôtes déjà
// appris. Les purger ferait retomber tous les visiteurs dans un seul seau
// à la première secousse réseau — c'est-à-dire rouvrir la panne — alors
// qu'un hôte appris ne devient pas douteux parce que Convex a hoqueté.

import { api } from "@astrotan/backend/convex/_generated/api"
import { getConvexClient } from "./convexClient"

/**
 * Un hôte nu : des étiquettes DNS séparées par des points. Ni schéma, ni
 * port, ni chemin, ni joker — ce que `WEB_DOMAIN` vaut dans
 * `docker/.env.example`, et ce que `routing.hotes` rend.
 *
 * Duplication assumée de `packages/backend/convex/lib/hoteNu.ts` :
 * `apps/web` n'importe pas de code du backend hors des types générés
 * (invariant 1), et une dépendance croisée pour une expression régulière
 * coûterait plus cher que la copie.
 */
const HOTE_NU = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/**
 * Combien de temps une liste d'hôtes LUE AVEC SUCCÈS reste valable.
 *
 * Le compromis se lit dans les deux sens. Trop long : un changement de
 * domaine mettrait des minutes à être reconnu, et les visiteurs arrivant
 * sur le nouvel hôte partageraient un seau pendant ce temps. Trop court :
 * une query Convex par visiteur, sur le chemin de chaque envoi de
 * formulaire.
 *
 * Une minute, pour une raison précise : elle est très en deçà de ce que
 * met le RESTE de la chaîne. Un changement de domaine attend deux passes
 * concordantes du service `routeur` (une trentaine de secondes), puis
 * l'émission d'un certificat Let's Encrypt, puis la propagation DNS. Ce
 * cache-ci n'est jamais le maillon lent, et il ramène le coût à une
 * lecture par minute et par instance — négligeable devant le trafic
 * qu'elle sert.
 *
 * C'est aussi la valeur du mémo des redirections (`src/middleware.ts`) :
 * deux caches sur la même horloge sont deux caches qu'on raisonne
 * ensemble.
 */
export const TTL_SUCCES_MS = 60_000

/**
 * Combien de temps un ÉCHEC de lecture est retenu.
 *
 * Bien plus court, et pour deux raisons opposées qu'il faut tenir
 * ensemble : un conteneur démarré pendant que Convex redémarre ne doit pas
 * rester une minute sans reconnaître son propre domaine ; et il ne doit
 * pas non plus marteler un service en panne à chaque requête reçue.
 */
export const TTL_ECHEC_MS = 5_000

/** Ce qui sait rendre les hôtes de ce déploiement. Injecté pour les tests. */
export type LecteurHotes = () => Promise<string[]>

let cache: { hotes: ReadonlySet<string>; expire: number } | null = null
/** La lecture en cours, partagée par toutes les requêtes qui l'attendent. */
let enVol: Promise<ReadonlySet<string>> | null = null

/**
 * Oublier ce qui a été appris. Les tests l'appellent entre deux cas ; rien
 * en production n'en a besoin, le TTL suffit.
 */
export function purgerHotesConnus(): void {
  cache = null
  enVol = null
}

/**
 * L'hôte tel qu'on le compare : minuscules, sans espaces, sans port et
 * sans le point final de la forme DNS absolue. `null` si ce n'en est pas un.
 */
export function hoteNormalise(brut: string | null | undefined): string | null {
  const hote = (brut ?? "")
    .trim()
    .toLowerCase()
    // Le port, quand le client l'a écrit (`exemple.fr:443`). Seulement des
    // chiffres : sans cette borne, `exemple.fr:quelque-chose` perdrait sa
    // fin et deviendrait `exemple.fr`.
    .replace(/:\d+$/, "")
    // Le point final est légal en DNS (`exemple.fr.` est la forme absolue)
    // et se colle facilement à un copier-coller depuis une zone.
    .replace(/\.$/, "")

  // Rien de plus permissif ici, et surtout pas un `new URL()` : il rendrait
  // `exemple.fr` pour `exemple.fr/blog` comme pour `http://exemple.fr`,
  // c'est-à-dire qu'il RÉPARERAIT des en-têtes malformés au lieu de les
  // refuser. Un `Host` qui n'est pas un hôte nu n'est pas notre hôte.
  return HOTE_NU.test(hote) ? hote : null
}

/** La première valeur d'un en-tête `x-forwarded-*`, qui peut en lister plusieurs. */
function premierMaillon(entete: string | null): string | null {
  if (entete === null) return null
  const premier = entete.split(",")[0]?.trim() ?? ""
  return premier.length === 0 ? null : premier
}

/**
 * Les hôtes de ce déploiement, lus sur Convex.
 *
 * Seul `web` est retenu : c'est le seul hôte que Traefik route vers ce
 * conteneur. Reconnaître `admin.<domaine>` ici ne servirait rien et
 * élargirait la surface pour une commodité imaginaire.
 *
 * **Et les hôtes SORTANTS avec lui.** Pendant une bascule de domaine, le
 * service `routeur` garde l'ancien hôte routé jusqu'à ce que le nouveau
 * serve un certificat valide, et des visiteurs continuent d'arriver dessus
 * tant que leur résolveur garde l'ancien enregistrement. Ne reconnaître
 * que l'hôte courant les faisait tous retomber sur l'adresse de la socket
 * — donc dans un seul seau de limitation de débit — pendant exactement la
 * fenêtre où l'adoptant est le plus fragile. `routing.hotes` les rend
 * (`convex/lib/hotesSortants.ts` porte la fenêtre de 72 h et sa
 * justification), et ils ne servent QU'À ÇA : honorer `x-forwarded-for`.
 * Rien ici n'accorde un accès — Traefik décide seul de ce qu'il route — ni
 * ne fabrique une origine de confiance.
 *
 * `ROUTING_SECRET` est un `process.env` du conteneur (invariant 7), la
 * même valeur que celle posée sur le déploiement Convex. Son absence n'est
 * pas rattrapée ici : le compose la déclare en `${ROUTING_SECRET:?…}`, si
 * bien qu'un conteneur sans elle ne démarre pas du tout — le refus tombe
 * au déploiement, pas dans le trafic.
 */
async function lireHotesDepuisConvex(): Promise<string[]> {
  const secret = process.env.ROUTING_SECRET
  if (!secret) throw new Error("ROUTING_SECRET absente — voir docker/.env.example")
  const hotes = await getConvexClient().query(api.routing.hotes, { secret })
  return [hotes.web, ...hotes.sortants]
}

/**
 * Les hôtes que ce déploiement reconnaît comme les siens, en cache.
 *
 * La lecture en cours est PARTAGÉE : sur un cache froid, cent requêtes
 * simultanées attendent la même promesse plutôt que d'ouvrir cent
 * connexions à Convex. C'est exactement l'état d'un conteneur qui vient de
 * redémarrer sous trafic.
 */
export async function hotesConnus(
  lire: LecteurHotes = lireHotesDepuisConvex,
): Promise<ReadonlySet<string>> {
  if (cache !== null && cache.expire > Date.now()) return cache.hotes
  if (enVol !== null) return enVol

  enVol = (async () => {
    try {
      const hotes = new Set(
        (await lire()).map((h) => hoteNormalise(h)).filter((h): h is string => h !== null),
      )
      cache = { hotes, expire: Date.now() + TTL_SUCCES_MS }
      return hotes
    } catch (erreur) {
      // Ce qui reste connu reste connu ; ce qui ne l'était pas ne le
      // devient pas. Voir l'en-tête : c'est là qu'est le raisonnement.
      const hotes = cache?.hotes ?? new Set<string>()
      cache = { hotes, expire: Date.now() + TTL_ECHEC_MS }
      // La dégradation est INVISIBLE dans les réponses du site : tout
      // continue de répondre, seule l'empreinte enregistrée change. Elle
      // doit donc s'annoncer quelque part, et `docker compose logs web`
      // est le seul endroit possible. Bornée par `TTL_ECHEC_MS`, elle ne
      // peut pas noyer le journal.
      console.warn(
        `[astrotan] hôtes du déploiement illisibles (${String(erreur)}) — ` +
          `${hotes.size === 0 ? "aucun hôte connu, `x-forwarded-for` ne sera pas honoré et les limiteurs de débit compteront tous les visiteurs ensemble" : "les hôtes déjà appris restent en vigueur"}.`,
      )
      return hotes
    } finally {
      enVol = null
    }
  })()

  return enVol
}

/**
 * L'adresse à laquelle imputer cette requête.
 *
 * `x-forwarded-for` s'il vient d'une requête dont l'hôte est l'un des
 * nôtres ; sinon `clientAddress`, c'est-à-dire l'adresse de la socket —
 * celle du proxy, la même pour tout le monde. Voir l'en-tête du fichier
 * pour ce que ce second cas coûte, et pourquoi il reste préférable à
 * l'inverse.
 */
export async function adresseDuVisiteur(
  contexte: { request: Request; clientAddress: string },
  lire: LecteurHotes = lireHotesDepuisConvex,
): Promise<string> {
  const transmise = premierMaillon(contexte.request.headers.get("x-forwarded-for"))
  // Rien à honorer : pas de proxy devant nous (le développement local), et
  // donc aucune raison de faire payer une lecture Convex à cette requête.
  if (transmise === null) return contexte.clientAddress

  const hotes = await hotesConnus(lire)
  if (hotes.size === 0) return contexte.clientAddress

  // `Host` OU `X-Forwarded-Host`, comme le faisait Astro. Traefik pose les
  // deux depuis la même valeur ; aucun n'est plus digne de confiance que
  // l'autre, et ce qui protège n'est pas le choix de l'en-tête mais le
  // fait que ce conteneur ne soit joignable que par le proxy.
  const candidats = [
    contexte.request.headers.get("host"),
    premierMaillon(contexte.request.headers.get("x-forwarded-host")),
  ]
  const reconnu = candidats.some((brut) => {
    const hote = hoteNormalise(brut)
    return hote !== null && hotes.has(hote)
  })

  return reconnu ? transmise : contexte.clientAddress
}

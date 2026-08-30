import { ConvexError, v } from "convex/values"
import { query } from "./_generated/server"
import { assertSharedSecret } from "./lib/sharedSecret"
import { normaliserHote } from "./lib/hoteNu"
import { sortantsValides, type HoteSortant } from "./lib/hotesSortants"

// Les hôtes que Traefik doit router, pour le service `routeur` — et pour
// lui seul.
//
// Aujourd'hui, changer de domaine demande de recréer les conteneurs : les
// règles de routage vivent dans des labels Docker
// (`traefik.http.routers.*.rule`, docker/docker-compose.yml), et un label
// ne change qu'à la recréation. Traefik bascule sur un provider FICHIER
// qu'il surveille, et ce fichier est écrit par un petit service qui lit
// cette query.
//
// Trois choses décident de la forme de ce module :
//
// 1. **Le service `routeur` n'a pas de session.** Il tourne dans un
//    conteneur, sans compte ni identité Better Auth. Il passe donc par une
//    query publique gardée par un SECRET PARTAGÉ — `ROUTING_SECRET`, un
//    `process.env` des deux côtés, jamais en base (invariant 7). Même
//    motif que `leads.submit` et `consent.record`.
//
// 2. **`settings.get` est publique et non authentifiée** (invariant 1).
//    `declaredDomain` n'y entre pas, et cette query-ci ne rend pas non plus
//    la ligne : elle rend trois hôtes, dérivés.
//
// 3. **Ce qui sort d'ici devient une règle de routage.** Une chaîne
//    arbitraire qui atteindrait le YAML de Traefik y injecterait ce
//    qu'elle veut — un `Host(...)` de plus, un service détourné. Toute
//    valeur venue de la base repasse donc par `normaliserHote`, et
//    `composerRoutes` (services/routeur) valide une SECONDE fois à
//    l'endroit où le texte est fabriqué. Ce n'est pas de la redondance :
//    les deux barrières sont sur des chemins différents, et celle qui
//    compte le plus est celle qui est la plus proche du YAML.
//
// 4. **Les hôtes SORTANTS sortent d'ici aussi.** Pendant une bascule, le
//    routeur garde l'ancien hôte routé jusqu'à ce que le nouveau serve un
//    certificat valide, et des visiteurs continuent d'arriver dessus tant
//    que le DNS n'est pas propagé. Rendre les seuls hôtes courants faisait
//    que ces visiteurs-là n'étaient pas reconnus, donc que leur
//    `x-forwarded-for` n'était pas honoré — une dégradation silencieuse
//    pendant exactement la fenêtre où l'adoptant est le plus fragile.
//    `sortants` la ferme, et `lib/hotesSortants.ts` porte la fenêtre, le
//    plafond, et ce qu'un hôte sortant autorise (honorer un en-tête, rien
//    de plus).

/**
 * Les trois hôtes, tels que Traefik doit les router à cet instant.
 *
 * `umami` vaut `null` quand aucun tableau de bord Umami n'est déployé —
 * ses deux services s'enlèvent du compose, et c'est un cas ORDINAIRE, pas
 * une erreur.
 */
export type Hotes = {
  web: string
  admin: string
  umami: string | null
}

/**
 * Ce que la query rend : les trois hôtes courants, **plus** les hôtes web
 * sortants.
 *
 * Un type distinct de `Hotes`, et pas un quatrième champ dedans, pour une
 * raison qui n'est pas cosmétique : `Hotes` est « ce que Traefik doit
 * router », et c'est ce que `composerRoutes` (services/routeur) prend en
 * entrée. Les sortants, eux, ne sont pas à router — le service `routeur`
 * les tient déjà, depuis le fichier qu'il a écrit, et il les retire quand
 * le nouvel hôte sert un certificat valide. Les faire entrer dans `Hotes`
 * les mettrait sur le chemin du YAML de Traefik, ce que personne ne
 * demande.
 *
 * `sortants` ne contient que des hôtes **web**. Ni `admin.<ancien>` ni
 * `stats.<ancien>` : Traefik ne route pas ces hôtes vers le conteneur du
 * site public, et le seul consommateur — `apps/web/src/lib/allowedDomains.ts`
 * — ne reconnaît déjà que l'hôte web. Les ajouter élargirait la surface
 * pour rien.
 */
export type HotesEtSortants = Hotes & {
  /**
   * Les hôtes web d'avant le dernier changement de domaine, encore dans
   * leur fenêtre, le plus récent d'abord.
   *
   * **Reconnus pour honorer `x-forwarded-for`, et pour rien d'autre.** Pas
   * un accès (Traefik décide seul de ce qu'il route), pas une origine de
   * confiance pour l'authentification (`lib/origines.ts`, qui compose
   * `baseURL` et `trustedOrigins`, ne les lit pas), pas une origine de
   * lien d'email.
   */
  sortants: string[]
}

/** L'hôte de l'environnement, s'il est un hôte nu. Sinon `null`. */
function depuisEnvironnement(nom: string): string | null {
  const brut = process.env[nom]
  return brut === undefined ? null : normaliserHote(brut)
}

/**
 * Les hôtes, à partir du domaine déclaré et de l'environnement.
 *
 * Séparée du `handler` pour être lisible d'un coup d'œil : c'est la règle
 * de dérivation entière, et elle tient en quinze lignes.
 *
 * @param declare la valeur BRUTE de `settings.declaredDomain`, telle
 * qu'elle est en base — non validée, exprès : c'est ici qu'on la valide.
 * @param precedents la valeur BRUTE de `settings.previousDomains`, non
 * validée pour la même raison — `sortantsValides` la revalide.
 * @param maintenant `Date.now()`, injecté pour que le test décide du temps.
 */
export function deriverHotes(
  declare: string | null | undefined,
  precedents?: readonly HoteSortant[] | undefined,
  maintenant: number = Date.now(),
): HotesEtSortants {
  // Le repli, d'abord. C'est l'état d'un déploiement neuf : personne n'a
  // encore ouvert l'écran des réglages, et le routage doit déjà marcher.
  const webEnv = depuisEnvironnement("WEB_DOMAIN")
  const adminEnv = depuisEnvironnement("ADMIN_DOMAIN")

  // Umami est OPTIONNEL, et c'est cette variable qui dit s'il est déployé.
  // Le domaine déclaré change les hôtes ; il ne déploie rien. Publier
  // `stats.<domaine>` pour un service absent ferait demander à Traefik un
  // certificat pour un nom sans enregistrement DNS — et chaque échec
  // compte dans le quota Let's Encrypt (cinq par domaine et par semaine),
  // ce que `docker/.env.example` documente déjà comme le piège numéro un
  // du déploiement.
  const umamiDeploye = process.env.UMAMI_DOMAIN !== undefined
  const umamiEnv = depuisEnvironnement("UMAMI_DOMAIN")

  // La valeur en base l'emporte — mais seulement si c'est un hôte nu.
  // `settings.update` valide déjà à l'écriture ; elle n'est pas le seul
  // chemin qui y écrit (migration, `npx convex run`, restauration de
  // sauvegarde), et une valeur douteuse doit REPLIER, jamais sortir.
  const declareValide = declare == null ? null : normaliserHote(declare)

  const web = declareValide ?? webEnv
  if (web === null) {
    // Échec FERMÉ : pas de routage vaut mieux qu'un mauvais routage.
    // Rendre `""` ferait composer `Host(``)`, que Traefik accepte comme
    // une règle qui ne matche rien — une panne muette au lieu d'une erreur.
    throw new ConvexError({ code: "NOT_CONFIGURED", field: "WEB_DOMAIN" })
  }

  // `admin.<domaine>` et `stats.<domaine>` sont la convention documentée
  // (`docker/.env.example`, et `dns.ts` qui vérifie déjà `admin.<hôte>`).
  //
  // Quand le domaine est déclaré, la convention s'applique : c'est tout
  // l'objet de la fonctionnalité — une seule valeur change, trois hôtes
  // suivent. Sinon, `ADMIN_DOMAIN` posé l'emporte : un déploiement
  // existant a pu publier son dashboard ailleurs, et lui réécrire son
  // routage sous prétexte de convention le mettrait hors ligne.
  const admin = declareValide !== null ? `admin.${declareValide}` : (adminEnv ?? `admin.${web}`)
  const umami = !umamiDeploye
    ? null
    : declareValide !== null
      ? `stats.${declareValide}`
      : umamiEnv

  // Les sortants sont dérivés APRÈS les courants, et ceux-ci leur sont
  // passés : un domaine repris après avoir été quitté est courant, pas
  // sortant, et n'a pas à figurer deux fois. `admin` et `umami` en font
  // partie pour la même raison de propreté, même si un hôte web sortant ne
  // peut pas les valoir.
  const sortants = sortantsValides(
    precedents,
    umami === null ? [web, admin] : [web, admin, umami],
    maintenant,
  )

  return { web, admin, umami, sortants }
}

/**
 * Les hôtes courants, pour le service `routeur`.
 *
 * @throws `FORBIDDEN` si le secret ne correspond pas, `NOT_CONFIGURED` si
 * aucun `ROUTING_SECRET` n'est posé sur ce déploiement. Les deux viennent
 * de `assertSharedSecret`, qui hache les deux côtés avant de comparer :
 * la réponse ne laisse fuir ni la longueur du secret attendu, ni un écart
 * mesurable au temps de réponse.
 *
 * `NOT_CONFIGURED` n'apprend rien d'exploitable : il dit qu'aucun secret
 * n'est posé, donc que PERSONNE ne passe — insister ne sert à rien. C'est
 * l'inverse qui serait dangereux (un déploiement mal configuré qui laisse
 * entrer), et c'est ce que le helper refuse déjà.
 */
export const hotes = query({
  args: { secret: v.string() },
  handler: async (ctx, args): Promise<HotesEtSortants> => {
    await assertSharedSecret(args.secret, process.env.ROUTING_SECRET)

    // La ligne entière n'est jamais rendue : on n'en lit que deux champs,
    // et on n'en fait sortir que ce qui a passé `normaliserHote`.
    const settings = await ctx.db.query("settings").first()
    // `Date.now()` dans une query : Convex le fige pour la durée de
    // l'exécution, donc la réponse reste cohérente avec elle-même. Ce
    // qu'il ne fait PAS, c'est réinvalider la query quand la fenêtre
    // expire — et ça n'a pas d'importance ici, parce qu'aucun des deux
    // consommateurs ne s'abonne : le service `routeur` interroge toutes
    // les trente secondes, `apps/web` met en cache soixante secondes.
    return deriverHotes(settings?.declaredDomain, settings?.previousDomains, Date.now())
  },
})

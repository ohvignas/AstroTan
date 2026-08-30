import { normaliserHote } from "./hoteNu"
import { sortantsValides, type HoteSortant } from "./hotesSortants"

// Les deux ORIGINES que composent les liens envoyés par email — et rien
// d'autre.
//
// Elles étaient deux variables d'environnement Convex, `SITE_URL` et
// `WEB_SITE_URL`, donc figées jusqu'au prochain `npx convex env set`. Le
// jour où l'adoptant change de domaine depuis `/settings/domaine`, tout le
// reste suit (Traefik, les certificats, la validation d'hôte du site) sauf
// elles : les invitations et les réinitialisations de mot de passe
// continuent de pointer vers l'ancien domaine. La panne est INVISIBLE tant
// que personne ne clique, et celui qui clique est justement quelqu'un qui
// essaie d'entrer.
//
// Trois choses décident de la forme de ce module :
//
// 1. **Le repli sur l'environnement est le cas NORMAL**, pas une erreur :
//    un déploiement neuf n'a pas de ligne `settings`, et un déploiement de
//    développement tourne sur `http://localhost:3001`, qui n'est pas un
//    domaine déclarable. Les deux doivent continuer de marcher tels quels.
//
// 2. **La valeur en base n'est pas de confiance.** `settings.update` la
//    valide à l'écriture, mais elle n'est pas le seul chemin qui y écrit
//    (migration, `npx convex run`, restauration de sauvegarde). Une valeur
//    douteuse REPLIE sur l'environnement, elle ne sort jamais — même
//    raisonnement que `routing.deriverHotes`, et le même `normaliserHote`.
//
// 3. **La convention des sous-domaines est celle du routage**, pas une
//    seconde : `admin.<domaine>`, exactement ce que `routing.deriverHotes`
//    compose pour Traefik et ce que `dns.ts` vérifie. Deux conventions
//    écrites à deux endroits divergeraient, et le jour où elles
//    divergent, le lien d'un email pointe vers un hôte que Traefik ne
//    route pas.
//
// `https` et non `http` : un domaine déclaré est un domaine que Traefik
// sert derrière un certificat Let's Encrypt (`docker/docker-compose.yml`).
// L'environnement, lui, garde son schéma tel qu'il est posé — c'est ce qui
// laisse `http://localhost:4321` fonctionner en développement.
//
// ── LES ORIGINES SORTANTES, ET POURQUOI CE MODULE LES LIT MAINTENANT ───
//
// Ce module a longtemps REFUSÉ de lire `settings.previousDomains`, et le
// refus était écrit noir sur blanc dans `lib/hotesSortants.ts` et dans
// `schema.ts` : « un hôte sortant autorise à honorer `x-forwarded-for`,
// rien de plus ; pas une origine de confiance pour l'authentification ».
// Le refus ne tient plus, pour une raison précise et vérifiée.
//
// **La séquence qui le casse**, au DEUXIÈME changement de domaine :
//
//   1. `SITE_URL` vaut `https://admin.A`. On passe à B. `trustedOrigines`
//      vaut `[admin.A, admin.B]` — mais `admin.A` n'y survit que par
//      COÏNCIDENCE, parce qu'elle se trouve être `SITE_URL`, que
//      better-auth pousse depuis `baseURL`.
//   2. Faute de frappe : on passe à C, qui n'obtient jamais de
//      certificat. Le routeur garde donc `admin.B` routé — c'est son
//      comportement voulu, et c'est le SEUL hôte encore joignable.
//   3. Sans les sortants, la liste vaut `[admin.A, admin.C]`. `admin.B`
//      n'y est plus. Tout `POST` depuis `https://admin.B` est refusé en
//      403 `INVALID_ORIGIN` — `/sign-in/email` comme
//      `/request-password-reset`. Une session déjà ouverte survit
//      (`/convex/token` est un GET, non contrôlé), mais une déconnexion,
//      une expiration ou un autre navigateur ferment la dernière porte.
//      Sortie : SSH ou `convex env set`.
//
// C'est exactement le verrouillage que tout ce lot existe pour éviter, et
// c'est la même règle qu'ailleurs — ajouter, vérifier, puis seulement
// retirer — appliquée à l'authentification comme elle l'est déjà au
// routage et à la validation d'hôte du site public.
//
// **La fenêtre et la borne ne sont PAS redécidées ici** : elles viennent
// de `sortantsValides` (`lib/hotesSortants.ts`, 72 h et cinq entrées, avec
// leur justification). Deux fenêtres pour la même notion de « sortant »
// divergeraient, et c'est précisément la classe d'erreur que ce dépôt a
// déjà payée plusieurs fois.
//
// **Ce qu'une origine sortante autorise — vérifié dans `better-auth`
// 1.6.17, pas supposé.** `trustedOrigins` sert à deux choses, et à deux
// seulement (`dist/api/middlewares/origin-check.mjs`) :
//
//   - `validateOrigin` : l'en-tête `Origin`/`Referer` d'une requête non
//     GET/HEAD/OPTIONS doit y correspondre. C'est le contrôle CSRF, et
//     c'est le seul qui décide si l'on peut ENTRER.
//   - `validateURL` : `callbackURL`, `redirectTo`, `errorCallbackURL` et
//     `newUserCallbackURL` doivent y correspondre. C'est un contrôle de
//     redirection ouverte.
//
// Elle n'accorde AUCUNE session, aucun rôle, aucune permission : la
// requête passe le contrôle d'origine puis affronte le mot de passe, la
// limitation de débit et le contrôle de rôle inchangés. Le seul
// élargissement réel est le second point — pendant 72 heures, un domaine
// que l'adoptant vient de quitter redevient une cible de redirection
// valide. On l'accepte : c'est un domaine qui était le sien il y a moins
// de trois jours, la fenêtre est bornée (c'est la raison même pour
// laquelle `FENETRE_SORTANTE_MS` n'est pas « toujours »), et l'alternative
// mesurée est l'enfermement décrit plus haut.
//
// **Ce qu'une origine sortante n'autorise toujours pas** : figurer dans un
// EMAIL. `admin` et `web` ci-dessous ne suivent que le domaine COURANT, et
// les appelants qui composent un lien (`invitations.ts`, `auth.ts`
// `sendResetPassword`, `leads.ts`) ne lisent que ces deux champs-là. Un
// lien envoyé vers un domaine qu'on est en train de quitter mènerait
// bientôt nulle part.
//
// ── ET LES ORIGINES WEB SORTANTES, POUR LA MÊME RAISON ─────────────────
//
// `revalidate.ts` `drain` avait le même défaut que celui décrit ci-dessus
// pour `admin`, sur `web` cette fois : il postait `/api/revalidate` sur le
// SEUL domaine déclaré — celui qui vient d'être écrit, et qui n'a encore ni
// certificat Let's Encrypt ni routage Traefik tant que le service `routeur`
// et l'ACME n'ont pas fini leur travail. Les six tentatives
// (`revalidate.ts`'s own `BACKOFF_MS`) s'épuisaient sur un hôte qui ne
// répond pas encore, la ligne passait `failed` — état terminal, jamais
// rejoué —, et les pages publiées pendant la bascule gardaient leur cache
// jusqu'à sa propre expiration.
//
// `webSortantes` ferme cette fenêtre par le même mécanisme que
// `adminSortantes`, et littéralement le même calcul (`sortantsValides`, 72
// h, cinq entrées) : `drain` poste sur le déclaré d'abord, puis sur chaque
// sortant dans l'ordre, jusqu'à la première réponse `2xx`. Ça marche parce
// que c'est le même conteneur `web`, donc le même cache, quel que soit
// l'hôte par lequel Traefik a routé la requête — Traefik décide seul de CE
// routage, ce module ne fait que composer l'URL à essayer.

export type Origines = {
  /** L'origine du dashboard — celle des liens d'invitation et de réinitialisation. */
  admin: string | null
  /** L'origine du site public — celle qu'on appelle pour invalider son cache. */
  web: string | null
  /**
   * Les origines du dashboard des domaines SORTANTS, encore dans leur
   * fenêtre — les plus récentes d'abord, sans doublon, jamais le domaine
   * courant.
   *
   * De confiance pour ENTRER, et rien d'autre (voir l'en-tête). Vide
   * partout où l'appelant ne passe pas `precedents`, ce qui est le cas de
   * TOUS les appelants qui composent un email.
   */
  adminSortantes: string[]
  /**
   * Les origines du site public des domaines SORTANTS, encore dans leur
   * fenêtre — même liste que `adminSortantes`, sans le sous-domaine
   * `admin.`.
   *
   * À RÉESSAYER pour l'invalidation de cache (`revalidate.ts` `drain`), et
   * rien d'autre — jamais un lien d'email, qui ne suit que `web`. Vide
   * partout où l'appelant ne passe pas `precedents`.
   */
  webSortantes: string[]
}

/**
 * Les deux origines, à partir du domaine déclaré et de l'environnement.
 *
 * Pure : elle ne lit ni la base ni `process.env` de son propre chef. C'est
 * ce qui la rend testable seule, et c'est là que vit toute la règle.
 *
 * @param declare la valeur BRUTE de `settings.declaredDomain`, telle
 * qu'elle est en base — non validée, exprès : c'est ici qu'on la valide.
 * @param env l'environnement du déploiement, injecté pour le test.
 * @param precedents la valeur BRUTE de `settings.previousDomains`, non
 * validée pour la même raison que `declare` — `sortantsValides` la
 * revalide, hôte par hôte. OMISE par défaut, et c'est délibéré : un
 * appelant n'obtient des origines sortantes que s'il les a demandées,
 * donc aucun chemin d'email n'en hérite par accident.
 * @param maintenant `Date.now()`, injecté pour que le test décide du
 * temps — c'est lui qui ouvre et ferme la fenêtre de 72 heures.
 *
 * `null` sur `admin` ou `web` veut dire « aucune origine connue » : ni
 * domaine déclaré, ni variable posée. Les appelants LÈVENT dans ce cas,
 * avec le message qu'ils levaient déjà — un job en échec, visible dans le
 * tableau de bord Convex, plutôt qu'un email amputé du lien qui permet
 * d'agir.
 */
export function deriverOrigines(
  declare: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
  precedents?: readonly HoteSortant[] | null,
  maintenant: number = Date.now(),
): Origines {
  const hote = declare == null ? null : normaliserHote(declare)

  // Le domaine courant est passé comme EXCLU, pas par politesse : un
  // domaine repris après avoir été quitté (A → B → A) est courant, et son
  // origine est déjà rendue par `admin`. Sans cette exclusion, la liste la
  // porterait deux fois.
  //
  // Quand `hote` est `null` — pas de domaine déclaré, ou une valeur
  // douteuse qui replie — les sortants sont dérivés quand même. C'est le
  // cas qui compte le plus : la ligne `settings` peut encore porter les
  // hôtes que le routeur route toujours, et les oublier ici rouvrirait
  // exactement l'enfermement. L'exclusion ne peut alors pas s'appliquer,
  // faute d'hôte courant connu — l'origine de repli vient de `SITE_URL`,
  // que better-auth pousse déjà de son côté depuis `baseURL`, si bien
  // qu'un doublon éventuel ne coûte qu'une entrée de plus dans une liste
  // que better-auth parcourt.
  // Un seul calcul pour les deux listes : `adminSortantes` et
  // `webSortantes` sont la même fenêtre, la même chaîne, la même liste de
  // sortants — seul le préfixe d'URL diffère. Deux appels à
  // `sortantsValides` avec les mêmes arguments donneraient le même résultat
  // deux fois ; ce serait aussi deux endroits où le faire diverger.
  const sortants = sortantsValides(precedents ?? undefined, hote === null ? [] : [hote], maintenant)
  const adminSortantes = sortants.map((sortant) => `https://admin.${sortant}`)
  const webSortantes = sortants.map((sortant) => `https://${sortant}`)

  if (hote === null) {
    return {
      admin: env.SITE_URL ?? null,
      web: env.WEB_SITE_URL ?? null,
      adminSortantes,
      webSortantes,
    }
  }
  return { admin: `https://admin.${hote}`, web: `https://${hote}`, adminSortantes, webSortantes }
}

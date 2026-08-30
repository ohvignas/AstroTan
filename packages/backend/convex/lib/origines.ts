import { normaliserHote } from "./hoteNu"

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

export type Origines = {
  /** L'origine du dashboard — celle des liens d'invitation et de réinitialisation. */
  admin: string | null
  /** L'origine du site public — celle qu'on appelle pour invalider son cache. */
  web: string | null
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
 *
 * `null` sur un champ veut dire « aucune origine connue » : ni domaine
 * déclaré, ni variable posée. Les appelants LÈVENT dans ce cas, avec le
 * message qu'ils levaient déjà — un job en échec, visible dans le tableau
 * de bord Convex, plutôt qu'un email amputé du lien qui permet d'agir.
 */
export function deriverOrigines(
  declare: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): Origines {
  const hote = declare == null ? null : normaliserHote(declare)
  if (hote === null) {
    return { admin: env.SITE_URL ?? null, web: env.WEB_SITE_URL ?? null }
  }
  return { admin: `https://admin.${hote}`, web: `https://${hote}` }
}

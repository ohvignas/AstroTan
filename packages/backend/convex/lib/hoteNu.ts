// Valider un hôte nu, côté backend.
//
// Duplication ASSUMÉE de `HOTE_NU` (`apps/web/src/lib/allowedDomains.ts`).
// `packages/backend` n'importe pas `apps/web` — la frontière est tenue par
// une règle ESLint (invariant 1) —, et une dépendance croisée pour une
// expression régulière coûterait plus cher que la copie. Les deux tests
// pointent la même liste de formes refusées : si l'une change, l'autre
// doit changer, et la divergence se voit à la relecture.
//
// « Nu » veut dire : ni schéma, ni port, ni chemin, ni joker. C'est ce que
// `WEB_DOMAIN` vaut dans `docker/.env`, et ce qu'Astro attend dans
// `security.allowedDomains`.
const HOTE_NU = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

export function estHoteNu(valeur: string): boolean {
  return HOTE_NU.test(valeur)
}

/**
 * L'hôte tel qu'on le comparera et l'interrogera, ou `null`.
 *
 * Le point final est légal en DNS (`exemple.fr.` est la forme absolue) et
 * se colle facilement à un copier-coller depuis une zone. Le garder ferait
 * échouer la comparaison avec `WEB_DOMAIN` sur un caractère invisible.
 */
export function normaliserHote(valeur: string): string | null {
  const nettoye = valeur.trim().toLowerCase().replace(/\.$/, "")
  return estHoteNu(nettoye) ? nettoye : null
}

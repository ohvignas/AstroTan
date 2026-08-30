// Valider un hôte nu, côté backend.
//
// Duplication ASSUMÉE de `HOTE_NU` (`apps/web/src/lib/allowedDomains.ts`).
// `packages/backend` n'importe pas `apps/web` — la frontière est tenue par
// une règle ESLint (invariant 1) —, et une dépendance croisée pour une
// expression régulière coûterait plus cher que la copie.
//
// **Les deux expressions ne sont PAS identiques**, et il ne faut pas lire
// ici qu'elles le sont — une relecture précédente l'affirmait, à tort.
// Celle-ci borne la longueur totale (253) et celle de chaque étiquette
// (63) ; celle d'`apps/web` ne borne ni l'une ni l'autre, et sa forme
// accepte en plus un hôte tout en chiffres (`1.2.3.4`) ou une étiquette de
// tête purement numérique (`exemple.123`), que celle-ci refuse.
//
// Sans conséquence AUJOURD'HUI, et c'est la seule chose sur laquelle
// compter : côté web, `HOTE_NU` (`allowedDomains.ts`) ne sert qu'à
// normaliser un `Host`/`X-Forwarded-Host` avant un test d'appartenance à
// `hotesConnus()` — un ensemble déjà validé PAR CETTE regex-ci, côté
// backend, avant d'être transmis. Une forme que le web laisserait passer
// mais que le backend aurait refusée n'appartient donc jamais à cet
// ensemble, et échoue au test d'appartenance quoi qu'il arrive. Ce que ça
// NE garantit PAS : que les deux expressions acceptent ou refusent les
// mêmes chaînes en général — seulement `lib/hotesSortants.ts` et
// `routing.ts` le font, ici. Un futur appelant qui utiliserait `HOTE_NU`
// d'`apps/web` pour valider un hôte de SA PROPRE main, sans le faire
// passer par `hotesConnus()`, ne pourrait pas s'appuyer sur cette garantie
// et devrait revalider contre celle-ci ou documenter pourquoi ce n'est pas
// nécessaire.
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

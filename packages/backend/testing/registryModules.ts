// Import statique (pas `import.meta.glob`, qui est paresseux) de chaque
// module qui s'enregistre lui-même dans `MUTATION_REGISTRY` comme effet de
// bord au chargement. Tout fichier qui importe CE barrel — plutôt que de
// dépendre du fait qu'une autre boucle de scan quelque part ait déjà
// chargé le module en question — a la garantie que le registre est
// entièrement peuplé avant que son propre code de haut niveau ne
// s'exécute. Ça compte pour du code qui lit `MUTATION_REGISTRY` au moment
// de la *collecte* des tests (par exemple : construire un `test()` par
// entrée du registre), pas seulement à l'intérieur d'un corps de test
// asynchrone où l'ordre importe moins.
//
// `convex/lib/authz.test.ts` en dépendait justement : sa matrice de
// permissions construit un `test()` par entrée du registre à la collecte,
// avant qu'aucun corps de test ne s'exécute — sans cet import statique ici
// (ou son équivalent), `MUTATION_REGISTRY` était vide à ce moment-là et la
// boucle ne générait silencieusement aucun test, alors que
// `_registry.test.ts` passait quand même (l'entrée était bien déclarée,
// juste jamais exercée par la matrice).
//
// Vit HORS de `convex/` (round 2 du fix, comme `betterAuthFixture.ts` —
// voir son en-tête pour la mesure complète contre un vrai `convex dev
// --once`) : ce barrel n'a AUCUN rôle en production. `MUTATION_REGISTRY`
// n'est lu qu'ici, dans les tests ; le runtime Convex réel n'en a jamais
// besoin pour exécuter une fonction, et `profiles.ts` (importé ci-dessous)
// est de toute façon chargé normalement par Convex comme point d'entrée
// réel, avec ou sans ce barrel — son import statique ici ne sert qu'à
// rendre ce chargement *déterministe au moment de la collecte des tests*,
// ce qui n'a de sens que côté test. Un fichier sans rôle en production ne
// devrait jamais avoir eu de raison de vivre sous `convex/` en premier
// lieu.
//
// Ajouter ici chaque nouveau module qui s'enregistre, au fur et à mesure
// qu'il est écrit (Tasks 8, 10, …).
import "../convex/profiles"
import "../convex/invitations"
import "../convex/users"
import "../convex/pages"
import "../convex/media"
import "../convex/tags"
import "../convex/posts"
import "../convex/settings"
import "../convex/redirects"
import "../convex/emails"
// `secretCheck.ts` ne se fait importer par aucun module de production —
// c'est l'écran qui appelle son action. Sans cette ligne, la matrice de
// `lib/authz.test.ts` (qui lit le registre à la COLLECTE) ne générerait
// aucun test de permission pour elle, pendant que `_registry.test.ts`
// passerait quand même : exactement le trou décrit plus haut.
import "../convex/secretCheck"
// Même raison que `secretCheck.ts` juste au-dessus : `resendDomain.ts` n'est
// importé par aucun module de production — c'est l'écran `/settings/domaine`
// qui appelle son action. Sans cette ligne, la matrice de `lib/authz.test.ts`
// (qui lit le registre à la COLLECTE) ne générerait aucun test de permission
// pour `resendDomain.declarer`, une action qui appelle un tiers avec la clé
// du déploiement.
import "../convex/resendDomain"
// Les quatre lignes suivantes comblent un trou trouvé à la relecture
// finale du lot : `leads.ts`, `consent.ts` et `analytics.ts` déclarent
// chacun leurs entrées dans `MUTATION_REGISTRY` (avec les bons rôles —
// vérifié en lisant le code, pas seulement le registre) depuis qu'ils
// existent, mais aucun module de production ne les importe et ce barrel
// ne les chargeait pas non plus. `_registry.test.ts` (qui découvre les
// modules par `import.meta.glob`) les voyait très bien et passait — la
// matrice de `lib/authz.test.ts`, qui lit `MUTATION_REGISTRY` à la
// COLLECTE, n'exerçait aucune de leurs neuf entrées. Un `requireRole`
// retiré de `leads.remove` ou de `dns.checkSite` serait passé inaperçu.
//
// `dns.ts` est un cas à part et non un oubli : il a été laissé dehors
// intentionnellement lors d'un premier passage, parce que la matrice
// APPELLE vraiment `checkSite`/`checkEmail` pour les rôles autorisés, et
// ces actions font un vrai `fetch` vers le résolveur DNS de Cloudflare
// (`lib/doh.ts`) — un domaine `exemple.invalid` (RFC 2606, voir le
// commentaire au-dessus du `MUTATION_REGISTRY.push` dans `dns.ts`) évite
// d'interroger un vrai domaine mais ne coupe pas la requête sortante
// elle-même. Renoncer au test aurait laissé le module le plus récent sans
// filet ; la correction retenue est plutôt de boucher `fetch` pour la
// durée de la matrice, exactement comme `dns.test.ts` le fait déjà pour
// ses propres tests (`vi.stubGlobal("fetch", …)`) — voir la matrice dans
// `lib/authz.test.ts` pour le stub. `dns` s'importe donc ici comme les
// trois autres, sans exception.
import "../convex/leads"
import "../convex/consent"
import "../convex/analytics"
import "../convex/dns"
// `ai.ts` n'est importé par aucun module de production — c'est l'éditeur
// de page/article qui appelle son action. Sans cette ligne, la matrice de
// `lib/authz.test.ts` (qui lit le registre à la COLLECTE) n'exercerait
// pas `ai.generateSeoGeo`.
import "../convex/ai"
// `dataforseo.ts` n'est importé par aucun module de production — c'est
// l'écran `/settings/mesure` qui appelle son action. Sans cette ligne,
// la matrice de `lib/authz.test.ts` n'exercerait pas `dataforseo.enregistrer`.
import "../convex/dataforseo"
import "../convex/seoRanks"

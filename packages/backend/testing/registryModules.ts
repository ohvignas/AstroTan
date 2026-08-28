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

import { expect, test } from "vitest"
import appSchema from "./schema"
import betterAuthSchema from "./betterAuth/schema"
import { TABLE_COVERAGE } from "./_dataRegistry"

// ---------------------------------------------------------------------
// La moitié « schéma » du garde-fou du registre des traitements.
//
// `processings` (`apps/web/src/config/legal.ts`) est PUBLIÉ sur
// `/confidentialite`. Une table qui stocke une donnée désignant quelqu'un
// sans ligne dans ce tableau rend la page publiée fausse (RGPD, articles
// 13 et 30). La seule protection était jusqu'ici une règle de relecture
// écrite en commentaire — « ouvrir les deux schémas et vérifier ». Elle a
// échoué deux fois, à la même place ; la seconde pour `auditLog`.
//
// Ce fichier ferme la CLASSE, pas l'instance, sur le modèle de
// `_registry.ts` : une table nouvelle fait échouer la suite tant qu'elle
// n'est pas classée. Elle peut l'être à tort — mais alors par écrit.
//
// L'autre moitié est dans `apps/web/src/config/legal.test.ts` : elle
// vérifie que chaque table déclarée pointe une finalité réellement
// publiée. Le découpage n'est pas cosmétique — `apps/web` n'a pas le droit
// d'importer le schéma Better Auth (invariant #1), et une règle ESLint a
// refusé la première version de ce garde-fou pour cette raison.
//
// CE QU'IL NE VOIT PAS, et il faut le dire pour que l'absence se relise :
// les tables des composants Convex tiers (`@convex-dev/rate-limiter`,
// `@convex-dev/resend`) ont leur propre schéma, hors de ces deux fichiers.
// Les compteurs du limiteur portent une clé `${ip}:${email}` et sont
// couverts à la main par la ligne « Ouvrir une session d'administration ».
// Un troisième composant stockant des personnes ne serait pas signalé ici.
// ---------------------------------------------------------------------

function toutesLesTables(): string[] {
  return [
    ...Object.keys(appSchema.tables),
    ...Object.keys(betterAuthSchema.tables),
  ].sort()
}

test("chaque table du schéma est classée : déclarée au registre, ou exemptée avec sa raison", () => {
  const nonClassees = toutesLesTables().filter((table) => !(table in TABLE_COVERAGE))
  expect(
    nonClassees,
    "Une table a été ajoutée à un schéma sans être classée dans " +
      "`convex/_dataRegistry.ts`. Si elle porte une donnée qui désigne " +
      "quelqu'un — une adresse, un nom, un identifiant de compte —, ajoutez-lui " +
      "une ligne dans `processings` (apps/web/src/config/legal.ts, publié sur " +
      "/confidentialite) et rattachez-la par `declaredAs`. Sinon, marquez-la " +
      "`exempt` AVEC SA RAISON : une table sans donnée personnelle se déclare " +
      "exemptée, elle ne s'oublie pas.",
  ).toEqual([])
})

test("aucune table classée n'a disparu du schéma", () => {
  // La réciproque, et elle compte autant : une entrée qui survit à sa
  // table fait croire le registre plus complet qu'il n'est, et la ligne de
  // `processings` qu'elle justifie reste publiée pour un traitement qui
  // n'existe plus. « En garder une pour faire sérieux est une déclaration
  // fausse », dit déjà l'en-tête de `legal.ts`.
  const connues = new Set(toutesLesTables())
  const fantomes = Object.keys(TABLE_COVERAGE).filter((table) => !connues.has(table))
  expect(fantomes).toEqual([])
})

test("une exemption sans raison n'est pas une exemption", () => {
  // Une chaîne vide passerait le test de classement tout en n'apprenant
  // rien : c'est exactement l'oubli qu'on croit avoir supprimé.
  const muettes = Object.entries(TABLE_COVERAGE)
    .filter(([, c]) => "exempt" in c && c.exempt.trim().length < 20)
    .map(([table]) => table)
  expect(muettes).toEqual([])
})

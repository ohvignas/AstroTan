import { expect, test } from "vitest"
import { processings, TABLE_COVERAGE } from "./legal"

// ---------------------------------------------------------------------
// La moitié « page publiée » du garde-fou du registre des traitements.
//
// `packages/backend/convex/_dataRegistry.test.ts` tient l'autre : que
// chaque table des deux schémas soit classée. Ici on vérifie le maillon
// qui relie ce classement au tableau réellement affiché sur
// `/confidentialite` — une table peut être « déclarée » et pointer une
// finalité que plus personne ne publie, auquel cas elle n'est pas
// déclarée du tout.
//
// Le découpage suit une frontière du dépôt, pas un goût : la vérification
// côté schéma a besoin du schéma Better Auth, qu'`apps/web` n'a pas le
// droit d'importer (invariant #1). `TABLE_COVERAGE` est un module de
// données pur, sans session ni schéma d'authentification.
// ---------------------------------------------------------------------

test("chaque table déclarée pointe une finalité qui existe vraiment", () => {
  const finalites = new Set(processings.map((p) => p.purpose))
  const orphelines = Object.entries(TABLE_COVERAGE)
    .filter(([, c]) => "declaredAs" in c && !finalites.has(c.declaredAs))
    .map(([table, c]) => `${table} → ${(c as { declaredAs: string }).declaredAs}`)
  expect(
    orphelines,
    "Une table est rattachée à une finalité qui n'est plus publiée sur " +
      "/confidentialite : classée, et pourtant non déclarée.",
  ).toEqual([])
})

test("chaque finalité publiée est portée par au moins une table", () => {
  // L'autre sens du même souci : une ligne de registre que plus aucune
  // table ne justifie décrit un traitement que le site ne fait plus.
  const declarees = new Set(
    Object.values(TABLE_COVERAGE)
      .filter((c): c is { declaredAs: string } => "declaredAs" in c)
      .map((c) => c.declaredAs),
  )
  // La mesure d'audience est le seul traitement sans table Convex : Umami
  // vit dans une base PostgreSQL séparée, hors des deux schémas. Nommée
  // plutôt que filtrée par une règle générale — l'exception doit être
  // aussi visible que la règle.
  const sansTable = processings
    .map((p) => p.purpose)
    .filter((purpose) => !declarees.has(purpose) && purpose !== "Mesurer l'audience du site")
  expect(sansTable).toEqual([])
})

test("le journal d'audit est déclaré, et sa conservation dit qu'elle est sans limite", () => {
  // `auditLog` conserve l'adresse électronique d'un administrateur
  // supprimé, dans une table que `retention.ts` ne balaie pas. La ligne
  // « Gérer les comptes » annonçait « jusqu'à la suppression du compte » :
  // sans cette déclaration-ci, la page publiée serait fausse sur le point
  // précis que le journal d'audit vient de créer.
  const couverture = TABLE_COVERAGE.auditLog
  expect(couverture, "auditLog doit être classé").toBeDefined()
  expect("declaredAs" in couverture!).toBe(true)
  const ligne = processings.find(
    (p) => p.purpose === (couverture as { declaredAs: string }).declaredAs,
  )
  expect(ligne).toBeDefined()
  // Une durée annoncée que rien n'applique est le défaut que ce dépôt a
  // déjà payé plusieurs fois. La durée réelle étant « sans limite », la
  // page l'écrit.
  expect(ligne!.retention).toContain("sans limite")
})

test("la conservation des comptes ne prétend plus que supprimer un compte l'efface", () => {
  // La contradiction que le journal d'audit a créée : les trois tables de
  // comptes sont bien supprimées, mais `auditLog` garde l'adresse. La
  // ligne publiée doit porter ce renvoi, sinon elle est fausse.
  const comptes = processings.find((p) => p.purpose === "Gérer les comptes de l'administration")
  expect(comptes).toBeDefined()
  expect(comptes!.retention).toContain("journal")
})

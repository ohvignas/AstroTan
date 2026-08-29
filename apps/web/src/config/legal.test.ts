import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
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

test("la durée de purge Umami écrite dans le SQL est celle publiée sur /confidentialite", () => {
  // Rien ne relie mécaniquement `docker/umami-purge.sql` (ce que le code
  // APPLIQUE) à la ligne « Mesurer l'audience du site » ci-dessus (ce que
  // la page ANNONCE) : sans ce test, l'un pourrait dire 13 mois pendant
  // que l'autre en applique 24, sans qu'aucun outil ne le remarque —
  // exactement le défaut que ce fichier existe pour rendre impossible pour
  // les tables Convex, et qui restait ouvert pour Umami.
  //
  // `apps/web` n'a pas de dépendance vers `docker/` : ce test lit le
  // fichier par son chemin, à la manière d'un test de contenu statique,
  // pas d'un import.
  const ici = dirname(fileURLToPath(import.meta.url))
  const sql = readFileSync(resolve(ici, "../../../../docker/umami-purge.sql"), "utf-8")

  // Seules les lignes de code comptent : le commentaire d'en-tête du
  // fichier SQL cite lui-même le motif `interval 'N months'` pour expliquer
  // le compte, ce qui fausserait un comptage sur le fichier entier.
  const lignesDeCode = sql
    .split("\n")
    .filter((ligne) => !ligne.trim().startsWith("--"))
    .join("\n")
  const durees = [...lignesDeCode.matchAll(/interval '(\d+) months?'/g)].map((m) => Number(m[1]))

  expect(durees.length, "aucune durée trouvée dans docker/umami-purge.sql").toBeGreaterThan(0)
  expect(
    new Set(durees).size,
    "toutes les occurrences de la durée dans docker/umami-purge.sql doivent être identiques " +
      "entre elles",
  ).toBe(1)

  const ligne = processings.find((p) => p.purpose === "Mesurer l'audience du site")
  expect(ligne, "la ligne « Mesurer l'audience du site » doit exister").toBeDefined()
  const dureePubliee = ligne!.retention.match(/^(\d+) mois/)
  expect(dureePubliee, "la ligne publiée doit commencer par « N mois »").not.toBeNull()

  expect(
    durees[0],
    "la durée appliquée par docker/umami-purge.sql doit être celle que /confidentialite publie",
  ).toBe(Number(dureePubliee![1]))
})

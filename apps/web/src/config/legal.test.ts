import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { consentConfig } from "./consent"
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

  // Le nombre seul ne dit pas ce que la requête FAIT. Une comparaison
  // inversée — `created_at > now() - interval '13 months'` — purgerait les
  // mesures récentes en gardant les anciennes, et ne changerait pas d'un
  // chiffre le compte ci-dessus. On exige donc que CHAQUE occurrence de la
  // durée vive dans la comparaison attendue, sur la colonne attendue.
  const comparaisons = [
    ...lignesDeCode.matchAll(/created_at\s*<\s*now\(\)\s*-\s*interval '\d+ months?'/g),
  ]
  expect(
    comparaisons.length,
    "chaque durée de docker/umami-purge.sql doit apparaître dans un " +
      "`created_at < now() - interval …` : une comparaison inversée ou une " +
      "autre colonne purgerait autre chose que ce que la page annonce",
  ).toBe(durees.length)

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

// ---------------------------------------------------------------------
// Les durées Convex — le maillon qui manquait encore
// ---------------------------------------------------------------------
// Le test ci-dessus lie `docker/umami-purge.sql` à la ligne « Mesurer
// l'audience ». Rien ne liait `packages/backend/convex/retention.ts` aux
// deux lignes qu'il purge, et les deux ont dérivé : la page annonçait
// « Aucune purge automatique n'est en place aujourd'hui » pour les fiches
// de contact, et « conservé sans limite, puisque c'est la preuve qui est
// demandée » pour les enregistrements de consentement — alors qu'un cron
// mensuel supprimait les unes à trois ans et les autres à un an.
//
// Le sens de l'erreur est celui qui coûte le plus cher : quelqu'un peut
// invoquer une preuve de consentement de quatorze mois pour répondre à une
// réclamation, et découvrir qu'elle a été supprimée.
//
// Comme pour le SQL d'Umami, `apps/web` ne dépend pas de `packages/backend`
// pour ces valeurs : les importer ferait entrer le runtime serveur de
// Convex dans le bundle du site. Le fichier est lu par son chemin.
//
// CE QUE CETTE MOITIÉ NE VÉRIFIE PAS — et il faut le lire avant de la
// croire plus forte qu'elle n'est.
//
// Les deux moitiés de ce fichier ne sont PAS de la même force, et
// l'asymétrie ne se voit pas à la lecture. Le test Umami plus haut exige
// que chaque durée du SQL apparaisse DANS LA COMPARAISON attendue, sur la
// colonne attendue : il lit donc le sens du `WHERE`, pas seulement le
// nombre. Les tests Convex ci-dessous ne lisent que la VALEUR des
// constantes, par expression régulière sur le texte de `retention.ts`.
// Ils ne voient rien de ce que `purge` en fait : inverser un `lt` en
// `gt` — donc supprimer les fiches RÉCENTES et garder les vieilles —
// les laisse tous les trois au vert.
//
// Ce n'est pas un trou du SYSTÈME, et c'est pour ça qu'on le laisse tel
// quel plutôt que de dupliquer ici une vérification qui existe déjà :
//
//   · `packages/backend/convex/retention.test.ts` couvre le SENS — « une
//     fiche à un jour de la limite reste, entière », « une preuve plus
//     vieille que la validité d'un consentement part ; une récente
//     reste ». L'inversion ci-dessus y est rouge ;
//   · `packages/backend/convex/crons.test.ts` verrouille le PLANNING —
//     un cron mensuel `retention-purge` qui appelle
//     `internal.retention.purge`, et rien d'autre au planning.
//
// La question à laquelle CE fichier répond est une autre, et c'est la
// seule : le nombre publié sur `/confidentialite` est-il celui que le
// code applique. Il n'a jamais prétendu répondre à « le code applique-t-il
// sa durée dans le bon sens » — mais rien ne le disait, et quelqu'un
// finirait par supprimer les tests d'en face en croyant ceux-ci
// suffisants.
function constantesDeRetention(): Record<string, number> {
  const ici = dirname(fileURLToPath(import.meta.url))
  const source = readFileSync(
    resolve(ici, "../../../../packages/backend/convex/retention.ts"),
    "utf-8",
  )
  const valeurs: Record<string, number> = {}
  for (const m of source.matchAll(/export const ([A-Z_]+_RETENTION_DAYS)\s*=\s*([^\n]+)/g)) {
    const nom = m[1]!
    const nettoye = m[2]!.trim()
    // Un produit d'entiers (`3 * 365`) ou un entier. Évalué à la main
    // plutôt que par `eval` : le fichier lu est du code, et un test qui
    // exécute le code qu'il inspecte n'inspecte plus rien.
    expect(
      nettoye,
      `${nom} n'est plus un produit d'entiers littéraux — adapter ce test`,
    ).toMatch(/^\d+(\s*\*\s*\d+)*$/)
    valeurs[nom] = nettoye.split("*").reduce((acc, n) => acc * Number(n.trim()), 1)
  }
  return valeurs
}

test("la durée publiée pour les fiches de contact est celle que le cron applique", () => {
  const { LEAD_RETENTION_DAYS } = constantesDeRetention()
  expect(LEAD_RETENTION_DAYS, "LEAD_RETENTION_DAYS introuvable dans retention.ts").toBeGreaterThan(0)

  const ligne = processings.find(
    (p) => p.purpose === "Répondre à un message envoyé par le formulaire de contact",
  )
  expect(ligne).toBeDefined()

  // Le nombre de jours, écrit en toutes lettres dans la page, est ce qui
  // rend la comparaison mécanique : « 3 ans » seul se compare mal à
  // `3 * 365`, et c'est justement l'approximation qui laisse dériver.
  const jours = ligne!.retention.match(/(\d+)\s*jours/)
  expect(jours, "la ligne publiée doit nommer sa durée en jours").not.toBeNull()
  expect(Number(jours![1])).toBe(LEAD_RETENTION_DAYS)

  // Le sens de la phrase, pas seulement son nombre : la ligne a longtemps
  // affirmé l'inverse exact de ce que le code fait.
  expect(ligne!.retention).not.toMatch(/aucune purge/i)
  expect(ligne!.retention).not.toMatch(/sans limite/i)
})

test("la durée publiée pour les preuves de consentement est celle que le cron applique", () => {
  const { CONSENT_RETENTION_DAYS } = constantesDeRetention()
  expect(CONSENT_RETENTION_DAYS, "CONSENT_RETENTION_DAYS introuvable dans retention.ts").toBeGreaterThan(0)

  const ligne = processings.find((p) => p.purpose === "Enregistrer le choix exprimé sur les cookies")
  expect(ligne).toBeDefined()

  // La ligne porte DEUX durées — celle du cookie dans le navigateur, et
  // celle de la preuve en base. On ne compare que la seconde, sinon le test
  // passerait en lisant la première.
  const enBase = ligne!.retention.split("En base")[1]
  expect(enBase, "la ligne doit distinguer « En base » de la durée du cookie").toBeDefined()
  const jours = enBase!.match(/(\d+)\s*jours/)
  expect(jours, "la moitié « En base » doit nommer sa durée en jours").not.toBeNull()
  expect(Number(jours![1])).toBe(CONSENT_RETENTION_DAYS)

  expect(enBase).not.toMatch(/sans limite/i)
})

test("la preuve n'est pas purgée avant que le bandeau ne redemande son avis", () => {
  // Le couplage que `retention.ts` déclare ne pas pouvoir vérifier lui-même
  // (« ces deux nombres DOIVENT rester égaux ») : `packages/backend` ne
  // dépend pas d'`apps/web`. Ici, les deux sont à portée.
  //
  // Une preuve purgée AVANT l'expiration du cookie laisserait un visiteur
  // porteur d'un consentement valide dont plus rien n'atteste — le pire des
  // deux sens, puisque le traitement continue sans preuve.
  const { CONSENT_RETENTION_DAYS } = constantesDeRetention()
  expect(CONSENT_RETENTION_DAYS).toBe(consentConfig.expirationDays)
})

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { experimental_AstroContainer as AstroContainer } from "astro/container"
import { expect, test } from "vitest"
import ConfidentialiteBody from "../components/legal/ConfidentialiteBody.astro"
import CookiesBody from "../components/legal/CookiesBody.astro"
import MentionsLegalesBody from "../components/legal/MentionsLegalesBody.astro"
import { consentConfig } from "./consent"
import { FIGURES } from "./facts"
import {
  ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED,
  AUDIT_CIBLE_NATURE,
  CIBLE_NATURES,
  dpo,
  legalEntity,
  legalHost,
  processings,
  TABLE_COVERAGE,
  type LegalEntity,
  type LegalHost,
  type Processing,
} from "./legal"
import { REPO_URL } from "./nav"

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

test("la durée publiée pour le chat est celle que le cron applique", () => {
  const { LEAD_RETENTION_DAYS } = constantesDeRetention()
  expect(LEAD_RETENTION_DAYS, "LEAD_RETENTION_DAYS introuvable dans retention.ts").toBeGreaterThan(0)

  const ligne = processings.find(
    (p) =>
      p.purpose ===
      "Répondre, dans le chat du site, aux questions d'un visiteur et qualifier sa demande",
  )
  expect(ligne, "la finalité chat doit être publiée").toBeDefined()
  expect(ligne!.retention).toContain("1095")

  const jours = ligne!.retention.match(/(\d+)\s*jours/)
  expect(jours, "la ligne chat doit nommer sa durée en jours").not.toBeNull()
  expect(Number(jours![1])).toBe(LEAD_RETENTION_DAYS)

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

// ---------------------------------------------------------------------
// Le garde-fou : refuser les valeurs d'exemple
// ---------------------------------------------------------------------
//
// Le défaut que ce bloc corrige : `legalEntity.name` vaut « AstroTan »,
// `legalHost` pointe un hébergeur figé, `facts.ts` publie les métriques du
// TEMPLATE (« 778 tests », « 1,3 ko de JavaScript »), et `nav.ts` pointe le
// dépôt GitHub d'AstroTan — quatre façons différentes, pour un site qui
// aurait oublié de les remplacer, de désigner AstroTan comme responsable de
// traitement, ou de publier la comptabilité d'un autre projet que le sien.
// Aucun des huit tests au-dessus de ce bloc ne les regarde : ils vérifient
// la cohérence interne des durées de rétention, jamais l'identité elle-même.
//
// La difficulté qui a dicté la forme de ce garde-fou : il doit être capable
// de refuser ces valeurs — sinon ce n'est qu'un commentaire de plus, le
// défaut même que ce bloc corrige — MAIS ce dépôt, tel qu'il est committé,
// LES CONTIENT ENCORE : ce repo est le template AstroTan lui-même, pas le
// site de quelqu'un. Un test qui échoue purement sur leur présence casse
// la CI de ce dépôt en permanence, ce qui n'est pas non plus tolérable, et
// qu'on ne corrige pas en les faisant tolérer silencieusement : ce serait le
// garde-fou décoratif qu'on vient de corriger ailleurs cette semaine, avec
// un visage différent.
//
// Le mécanisme retenu — un marqueur explicite qu'il faut RETIRER :
// `ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED`, exporté par `legal.ts`, vaut
// `true` dans ce dépôt. Tant qu'il vaut `true`, ce test tolère les valeurs
// d'exemple ci-dessous : c'est la déclaration explicite, visible en tête de
// `legal.ts`, que ce dépôt EST le template non personnalisé — pas un
// contournement silencieux. Dès qu'il vaut `false` — ce que fait un
// adoptant en train de personnaliser le site, à n'importe quel moment de sa
// checklist — ce test exige qu'AUCUNE valeur d'exemple ne subsiste, et
// nomme précisément celles qui restent. Passer le marqueur à `false` AVANT
// d'avoir tout rempli est un usage valide : le test rougit alors comme une
// liste de tâches, et il n'y a aucune manière de le faire repasser au vert
// sans avoir réellement remplacé les valeurs qu'il liste — remettre le
// marqueur à `true` après avoir commencé à personnaliser le reste serait un
// mensonge qu'un relecteur humain peut repérer à la lecture du diff, ce
// qu'aucun mécanisme purement automatique ne peut garantir à la place d'une
// revue de code.
//
// Alternatives envisagées et écartées :
//   - Un avertissement en sortie de console : personne ne les lit, et
//     c'est très exactement le reproche fait au défaut d'origine.
//   - Un garde-fou au build (`astro build` qui échoue) : REFUSÉ, et pas
//     seulement pour une raison de périmètre de fichiers. Ce dépôt EST le
//     template non personnalisé — faire échouer son propre build dessus
//     bloquerait ce dépôt lui-même et quiconque vérifie « le site se
//     construit », en punissant l'auteur du template plutôt que l'adoptant
//     qui publie une fausse identité. Voir plus bas ce qui a pris la place
//     de cette idée.
//   - Faire échouer le test dès que les valeurs d'exemple sont présentes,
//     sans marqueur : casse la CI de ce dépôt en permanence, pour un signal
//     qu'un adoptant ne verrait alors jamais différemment de son propre
//     échec normal en cours de personnalisation.
//
// CE QUE CE BLOC NE COUVRAIT PAS, ET QU'UNE RELECTURE A TROUVÉ : le cas
// réel n'est pas « l'adoptant retire le marqueur trop tôt » (couvert
// ci-dessus), c'est « l'adoptant n'ouvre jamais `legal.ts` ». Marqueur resté
// à `true`, valeurs d'exemple intactes, ce test vert, CI verte — et rien
// ici n'empêchait `/mentions-legales` de publier « AstroTan » comme
// responsable de traitement et `/confidentialite` de proposer
// `mailto:contact@exemple.fr` pour exercer ses droits RGPD. Un test qui ne
// regarde QUE `legal.ts`, `facts.ts` et `nav.ts` ne peut structurellement
// pas voir ça : le défaut n'est pas dans ces fichiers, il est dans ce que
// les PAGES en font.
//
// La correction n'est donc pas ici, mais dans les pages elles-mêmes :
// `mentions-legales.astro`, `confidentialite.astro` et `cookies.astro`
// délèguent maintenant leur contenu à `MentionsLegalesBody.astro`,
// `ConfidentialiteBody.astro` et `CookiesBody.astro`
// (`src/components/legal/`), qui remplacent `legalEntity` / `legalHost` par
// un avis explicite — jamais un échec de build, une page qui dit
// honnêtement « non renseigné » — tant que le marqueur vaut `true`. C'est
// CE mécanisme qui rend sûr de ne jamais toucher `legal.ts` : ce test
// (qui suppose qu'on a déjà ouvert ce fichier) reste un filet utile une
// fois la personnalisation commencée, mais il n'est plus, à lui seul, ce
// qui empêche une identité fausse d'être publiée. Les tests plus bas
// (« publication : ») rendent le corps des trois pages et vérifient le
// nouveau mécanisme dans les deux sens — voir leur en-tête pour le détail,
// et `ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED` dans `legal.ts` pour le
// raisonnement complet des deux couches ensemble.

/** Recopie littérale des valeurs livrées par défaut — voir `legal.ts` et `facts.ts`. */
const VALEURS_EXEMPLE = {
  legalEntity: {
    name: "AstroTan",
    form: "Projet open source — à remplacer par votre raison sociale",
    address: "Adresse à compléter",
    email: "contact@exemple.fr",
    publicationDirector: "À compléter",
  },
  // Ces trois-là nommaient Hostinger — l'hébergeur de l'auteur, recopié une
  // fois. Ce sont maintenant des marques à remplir, et il FAUT qu'elles
  // restent recopiées ici : c'est cette liste qui refuse qu'un adoptant
  // passe le marqueur à `false` en les ayant laissées en place. Les
  // remplacer dans `legal.ts` sans les remplacer ici rendrait ce garde-fou
  // muet sur l'hébergeur, sans que rien ne le dise.
  legalHost: {
    name: "Hébergeur à compléter",
    address: "Adresse de l'hébergeur à compléter",
    contact: "Site ou téléphone de l'hébergeur à compléter",
  },
  repoUrl: "https://github.com/OhVignas/AstroTan",
}

function detecterSentinelles(): string[] {
  const trouvees: string[] = []

  for (const [champ, valeur] of Object.entries(VALEURS_EXEMPLE.legalEntity)) {
    if (legalEntity[champ as keyof typeof legalEntity] === valeur) {
      trouvees.push(`legalEntity.${champ} vaut encore « ${valeur} »`)
    }
  }

  for (const [champ, valeur] of Object.entries(VALEURS_EXEMPLE.legalHost)) {
    if (legalHost[champ as keyof typeof legalHost] === valeur) {
      trouvees.push(`legalHost.${champ} vaut encore « ${valeur} »`)
    }
  }

  // Comparaison sur `value` + `label` uniquement (pas `detail`, en prose
  // libre) : c'est le couple qui porte le chiffre et ce qu'il mesure — la
  // signature d'une métrique du TEMPLATE, pas de votre site. Comparaison
  // globale plutôt que champ par champ : `FIGURES` est une liste, pas des
  // propriétés indépendantes d'une même identité — soit ce sont encore
  // celles d'AstroTan, soit elles ont été mesurées sur le vrai site.
  const figuresActuelles = FIGURES.map((f) => `${f.value}|${f.label}`)
  if (JSON.stringify(figuresActuelles) === JSON.stringify(getDefaultFigures())) {
    trouvees.push("facts.ts publie encore les chiffres mesurés sur le template AstroTan (FIGURES)")
  }

  if (REPO_URL === VALEURS_EXEMPLE.repoUrl) {
    trouvees.push(`nav.ts (REPO_URL) pointe encore « ${VALEURS_EXEMPLE.repoUrl} »`)
  }

  return trouvees
}

/**
 * Recopie littérale de `FIGURES` telle que livrée par `facts.ts`. Un import
 * suffirait pour la valeur courante — utile pour la comparer à elle-même —
 * mais ce test doit détecter que `FIGURES` n'a PAS changé depuis la livraison
 * du template, ce qu'une comparaison à sa propre valeur ne peut jamais faire.
 */
function getDefaultFigures() {
  return [
    { value: "1,3 ko", label: "de JavaScript en tout" },
    { value: "26 ko", label: "à la première visite" },
    { value: "778", label: "tests automatisés" },
    { value: "1", label: "commande pour revenir en arrière" },
  ].map((f) => f.value + "|" + f.label)
}

test("aucune valeur d'exemple ne peut atteindre la production sans refus explicite", () => {
  const sentinelles = detecterSentinelles()
  if (sentinelles.length === 0) return

  expect(
    ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED,
    [
      "Ce dépôt publie encore des valeurs d'exemple :",
      ...sentinelles.map((s) => `  - ${s}`),
      "",
      "Si ce dépôt EST le template AstroTan tel quel (pas un site en production),",
      "c'est attendu : ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED (dans legal.ts) doit",
      "rester à `true`, et ce test doit rester vert avec ces valeurs en place.",
      "",
      "Si vous personnalisez ce template pour un vrai site : ne passez PAS ce",
      "marqueur à `false` tant que la liste ci-dessus n'est pas vide — ou passez-le",
      "à `false` dès maintenant et utilisez cette liste comme votre feuille de route.",
    ].join("\n"),
  ).toBe(true)
})

// ---------------------------------------------------------------------
// Ce que le TEMPLATE a le droit de livrer
// ---------------------------------------------------------------------
//
// Le test au-dessus ne se déclenche qu'une fois le marqueur passé à
// `false` — il regarde l'adoptant. Celui-ci regarde le template, et il est
// vrai dans l'AUTRE état : tant que le marqueur vaut `true`, aucune valeur
// livrée ne doit pouvoir passer pour une vraie.
//
// LE DÉFAUT QU'IL FERME. `legalHost` codait Hostinger : raison sociale
// complète, adresse à Larnaca, URL qui répond. Les quatre autres champs de
// la section « À REMPLIR » s'annoncent — « Adresse à compléter »,
// « À compléter », « contact@exemple.fr », « à remplacer par votre raison
// sociale ». Celui-là, seul, se lisait comme DÉJÀ FAIT. C'est le pire
// endroit où le faire : l'hébergeur est une mention obligatoire (LCEN
// art. 6-III), et c'est la seule que le template ne peut structurellement
// pas connaître — elle désigne une machine qu'il ne fournit pas. Un
// adoptant qui déploie sur OVH, Scaleway ou Hetzner et qui parcourt ce
// fichier en cherchant ce qui reste à remplir passe devant sans s'arrêter.
//
// Rien dans ce dépôt ne dépend d'Hostinger : `docker/`, Traefik, le
// compose et les workflows décrivent un VPS Docker quelconque, et la seule
// mention (`docker/README.md` §3) est une remarque sur le DNS Cloudflare
// qu'un VPS Hostinger apporte souvent. Il n'y a donc pas d'« hébergeur de
// référence » : il y avait l'hébergeur de l'auteur, recopié une fois.
//
// La règle est donc : LE TEMPLATE PEUT SE NOMMER LUI-MÊME, IL NE PEUT
// NOMMER PERSONNE D'AUTRE. Elle ferme la classe et pas seulement le cas —
// une adresse postale réelle pré-remplie dans `legalEntity` rougirait
// pareil.

/**
 * Un champ qui s'annonce comme à remplir, plutôt que de passer pour rempli.
 *
 * « AstroTan » est admis : le template se nommant lui-même ne trompe
 * personne — aucun adoptant ne lit sa propre raison sociale là-dedans — et
 * c'est la chaîne sur laquelle repose déjà tout le reste du garde-fou.
 */
function sAnnonceCommeAtRemplir(valeur: string): boolean {
  return /compléter|remplacer|exemple|AstroTan/i.test(valeur)
}

test("le template ne livre aucune identité légale qui puisse passer pour vraie", () => {
  if (!ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED) return

  const habillees: string[] = []
  const champs: [string, Record<string, string | undefined>][] = [
    ["legalEntity", legalEntity as unknown as Record<string, string | undefined>],
    ["legalHost", legalHost as unknown as Record<string, string | undefined>],
  ]
  for (const [nom, bloc] of champs) {
    for (const [champ, valeur] of Object.entries(bloc)) {
      if (valeur === undefined || valeur === "") continue
      if (sAnnonceCommeAtRemplir(valeur)) continue
      habillees.push(`${nom}.${champ} vaut « ${valeur} »`)
    }
  }

  expect(
    habillees,
    [
      "Ce template livre une valeur légale qui ressemble à une valeur remplie :",
      ...habillees.map((h) => `  - ${h}`),
      "",
      "Tant qu'ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED vaut `true`, chaque champ de",
      "`legalEntity` et de `legalHost` doit s'ANNONCER comme à remplir. Une valeur",
      "plausible — le nom d'un vrai hébergeur, une vraie adresse postale — se lit",
      "comme déjà faite : un adoptant la laisse en place, et publie une mention",
      "légale obligatoire qui est fausse. Le template peut se nommer lui-même ;",
      "il ne peut nommer personne d'autre.",
    ].join("\n"),
  ).toEqual([])
})

// ---------------------------------------------------------------------
// Publication : les trois pages ne publient jamais l'identité d'exemple
// ---------------------------------------------------------------------
//
// Le bloc au-dessus (`ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED`) ne regarde que
// `legal.ts`, `facts.ts` et `nav.ts` — pas ce que les PAGES en font avec ces
// valeurs. Une relecture a trouvé le trou exact que ça laissait : marqueur
// resté à `true` parce que personne n'a ouvert `legal.ts`, valeurs
// d'exemple intactes, le test au-dessus vert, CI verte — et rien n'empêchait
// `/mentions-legales` de publier « AstroTan » comme responsable de
// traitement, ni `/confidentialite` de proposer `mailto:contact@exemple.fr`
// pour exercer ses droits RGPD. Un test qui ne lit QUE de la config ne peut
// structurellement pas voir un défaut qui vit dans ce que les pages en
// FONT.
//
// La correction vit dans les pages elles-mêmes : `mentions-legales.astro`,
// `confidentialite.astro` et `cookies.astro` délèguent maintenant leur
// contenu à `MentionsLegalesBody`, `ConfidentialiteBody` et `CookiesBody`
// (`src/components/legal/`), qui remplacent `legalEntity` / `legalHost` par
// un avis explicite — jamais un échec de build — tant que le marqueur vaut
// `true`. Explicitement écarté : faire échouer `astro build` sur ce
// marqueur bloquerait ce dépôt LUI-MÊME, qui est le template non
// personnalisé, et punirait l'auteur du template plutôt que l'adoptant qui
// publierait une fausse identité.
//
// Les tests ci-dessous rendent le HTML réel de ces trois composants via le
// Container API d'Astro (`astro/container`, déjà utilisé par
// `src/pages/api/_tests/revalidate.test.ts`), avec une identité fictive
// « adoptant » — pas celle, réelle et actuellement encore d'exemple, de ce
// dépôt — pour que ces tests ne dépendent pas de la valeur courante de
// `legalEntity`. Chaque section est vérifiée dans les DEUX sens : masquée
// quand le marqueur vaut `true`, publiée quand il vaut `false`. Le second
// sens n'est pas optionnel — un garde-fou qui masquerait tout, tout le
// temps, indépendamment du marqueur, passerait le premier test sans rien
// prouver. Un dernier test, en fin de bloc, rejoue la même vérification
// avec les valeurs RÉELLEMENT exportées par `legal.ts` aujourd'hui.

const IDENTITE_ADOPTANT: LegalEntity = {
  name: "Exemple Test SARL",
  form: "SARL au capital de 1 000 €",
  address: "1 rue de Test, 75000 Paris",
  email: "contact@exemple-test.fr",
  publicationDirector: "Jane Test",
}

const HEBERGEUR_ADOPTANT: LegalHost = {
  name: "Test Hosting SAS",
  address: "2 rue du Cloud, 75000 Paris",
  contact: "https://test-hosting.example",
}

const TRAITEMENT_FICTIF: Processing[] = [
  {
    purpose: "Traitement fictif pour le test",
    data: "Aucune",
    basis: "Test",
    retention: "Test",
    recipients: "Test",
  },
]

/**
 * Chaque valeur de `IDENTITE_ADOPTANT` / `HEBERGEUR_ADOPTANT`, à chercher
 * dans le HTML rendu. Choisies distinctes du texte des avis eux-mêmes (qui
 * nomme « AstroTan » légitimement) pour qu'un `.not.toContain` ne puisse
 * jamais donner un faux vert par recoupement accidentel avec la prose du
 * garde-fou.
 */
const MARQUEURS_IDENTITE_ADOPTANT = [
  IDENTITE_ADOPTANT.name,
  IDENTITE_ADOPTANT.address,
  IDENTITE_ADOPTANT.email,
  `mailto:${IDENTITE_ADOPTANT.email}`,
  IDENTITE_ADOPTANT.publicationDirector,
  HEBERGEUR_ADOPTANT.name,
  HEBERGEUR_ADOPTANT.address,
]

test("mentions légales : masque l'identité tant que le marqueur vaut true", async () => {
  const container = await AstroContainer.create()
  const html = await container.renderToString(MentionsLegalesBody, {
    props: { entity: IDENTITE_ADOPTANT, host: HEBERGEUR_ADOPTANT, unconfigured: true },
  })
  for (const marqueur of MARQUEURS_IDENTITE_ADOPTANT) {
    expect(
      html,
      `« ${marqueur} » ne doit pas apparaître tant que l'identité n'est pas configurée`,
    ).not.toContain(marqueur)
  }
  expect(html).toContain("Identité non renseignée")
})

test("mentions légales : publie la vraie identité une fois le marqueur à false", async () => {
  const container = await AstroContainer.create()
  const html = await container.renderToString(MentionsLegalesBody, {
    props: { entity: IDENTITE_ADOPTANT, host: HEBERGEUR_ADOPTANT, unconfigured: false },
  })
  for (const marqueur of MARQUEURS_IDENTITE_ADOPTANT) {
    expect(html, `« ${marqueur} » doit apparaître une fois l'identité configurée`).toContain(marqueur)
  }
  expect(html).not.toContain("Identité non renseignée")
})

test("confidentialité : masque l'identité et l'adresse d'exercice des droits RGPD tant que le marqueur vaut true", async () => {
  const container = await AstroContainer.create()
  const html = await container.renderToString(ConfidentialiteBody, {
    props: {
      entity: IDENTITE_ADOPTANT,
      dpo: null,
      processings: TRAITEMENT_FICTIF,
      unconfigured: true,
      consentVersion: "1",
    },
  })
  expect(html).not.toContain(IDENTITE_ADOPTANT.name)
  expect(html).not.toContain(IDENTITE_ADOPTANT.address)
  expect(html).not.toContain(`mailto:${IDENTITE_ADOPTANT.email}`)
  // Le point précis relevé en relecture : une adresse RGPD qui n'existe pas
  // est PIRE qu'une absence d'adresse — elle laisse croire qu'une demande a
  // une chance d'arriver. Ce test échoue si un `mailto:` apparaît n'importe
  // où dans « Vos droits » tant que le marqueur vaut `true`.
  expect(html).toContain("Ce site n'a pas encore renseigné d'adresse pour exercer ces droits")
  // Le registre des traitements, lui, est réel et reste publié même non
  // configuré : ce n'est pas une valeur d'exemple, il ne doit jamais être
  // caché par ce mécanisme.
  expect(html).toContain("Traitement fictif pour le test")
})

test("confidentialité : publie la vraie identité et une vraie adresse de contact une fois le marqueur à false", async () => {
  const container = await AstroContainer.create()
  const html = await container.renderToString(ConfidentialiteBody, {
    props: {
      entity: IDENTITE_ADOPTANT,
      dpo: null,
      processings: TRAITEMENT_FICTIF,
      unconfigured: false,
      consentVersion: "1",
    },
  })
  expect(html).toContain(IDENTITE_ADOPTANT.name)
  expect(html).toContain(`mailto:${IDENTITE_ADOPTANT.email}`)
  expect(html).not.toContain("Ce site n'a pas encore renseigné d'adresse pour exercer ces droits")
  expect(html).toContain("Traitement fictif pour le test")
})

test("cookies : masque l'adresse de contact tant que le marqueur vaut true", async () => {
  const container = await AstroContainer.create()
  const html = await container.renderToString(CookiesBody, {
    props: {
      entity: IDENTITE_ADOPTANT,
      unconfigured: true,
      tags: [],
      ask: false,
      umami: false,
      expirationDays: 180,
    },
  })
  expect(html).not.toContain(`mailto:${IDENTITE_ADOPTANT.email}`)
  expect(html).toContain("aucune adresse n'est encore configurée")
})

test("cookies : publie une vraie adresse de contact une fois le marqueur à false", async () => {
  const container = await AstroContainer.create()
  const html = await container.renderToString(CookiesBody, {
    props: {
      entity: IDENTITE_ADOPTANT,
      unconfigured: false,
      tags: [],
      ask: false,
      umami: false,
      expirationDays: 180,
    },
  })
  expect(html).toContain(`mailto:${IDENTITE_ADOPTANT.email}`)
})

test("le dépôt réel (marqueur et identité tels que committés) ne publie aucune des valeurs d'exemple sur les trois pages", async () => {
  // Le test qui referme la boucle : pas une identité fictive, celle
  // RÉELLEMENT exportée par `legal.ts` aujourd'hui, avec le marqueur RÉEL.
  // S'il devait un jour valoir `false` sans que les valeurs aient
  // vraiment changé, c'est CE test qui le remarquerait le premier — les
  // deux tests « masque » ci-dessus, avec leur identité fictive, ne
  // pourraient pas.
  const container = await AstroContainer.create()
  const [mentionsHtml, confidentialiteHtml, cookiesHtml] = await Promise.all([
    container.renderToString(MentionsLegalesBody, {
      props: {
        entity: legalEntity,
        host: legalHost,
        unconfigured: ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED,
      },
    }),
    container.renderToString(ConfidentialiteBody, {
      props: {
        entity: legalEntity,
        dpo,
        processings,
        unconfigured: ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED,
        consentVersion: "1",
      },
    }),
    container.renderToString(CookiesBody, {
      props: {
        entity: legalEntity,
        unconfigured: ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED,
        tags: [],
        ask: false,
        umami: false,
        expirationDays: 180,
      },
    }),
  ])

  // Comparées littéralement, jamais via le seul mot « AstroTan » : il
  // apparaît aussi, légitimement, dans le texte de l'avis lui-même
  // (« … template AstroTan, pas la vôtre »).
  const interdits = [
    legalEntity.form,
    legalEntity.address,
    legalEntity.email,
    `mailto:${legalEntity.email}`,
    legalEntity.publicationDirector,
    legalHost.name,
    legalHost.address,
  ]
  for (const html of [mentionsHtml, confidentialiteHtml, cookiesHtml]) {
    for (const valeur of interdits) {
      expect(html, `« ${valeur} » ne doit apparaître sur aucune des trois pages`).not.toContain(valeur)
    }
  }
})

// ---------------------------------------------------------------------
// La moitié « page publiée » du garde-fou du JOURNAL D'AUDIT.
//
// Les tests plus haut vérifient que `auditLog` est CLASSÉE et que sa
// conservation dit « sans limite ». Aucun ne regardait ce que la ligne
// publiée énumère en face du champ `data` — et c'est exactement par là que
// la page est devenue fausse : huit actions ajoutées à `AUDIT_ACTIONS`,
// dont trois écrivant des catégories que ce texte ne nommait pas
// (l'adresse d'une personne invitée, l'adresse du titulaire lors d'une
// réinitialisation, le titre d'un e-mail type), sans qu'un seul test ne
// rougisse.
//
// LE MAILLON, et il est le point de toute cette affaire : une action est
// un identifiant (`invitation.create`), le registre est une phrase
// française. Rien ne les relie de soi. Exiger la chaîne
// `"invitation.create"` dans le texte publié donnerait une page que
// personne ne peut lire ; ne rien exiger ne protège de rien. Ce que le
// journal écrit en `cible` a en revanche un petit nombre de NATURES, et ce
// sont elles que la page énumère. `AUDIT_CIBLE_NATURE` /`CIBLE_NATURES`
// (`packages/backend/convex/_dataRegistry.ts`) déclarent la
// correspondance à un seul endroit ; `convex/lib/auditEvent.test.ts` tient
// l'autre bout — toute action a une nature.
// ---------------------------------------------------------------------

/** La ligne de registre qui couvre `auditLog`, retrouvée par son classement. */
function ligneDuJournal(): Processing {
  const couverture = TABLE_COVERAGE.auditLog
  const ligne = processings.find(
    (p) => p.purpose === (couverture as { declaredAs: string }).declaredAs,
  )
  expect(ligne, "aucune ligne de `processings` ne couvre `auditLog`").toBeDefined()
  return ligne!
}

// `data` est concaténé sur une douzaine de lignes de source : comparer les
// espaces à l'identique casserait au premier reformatage, pour une raison
// qui n'a rien à voir avec le registre. La casse tombe pour la même raison
// — une catégorie déplacée en tête de phrase prend une majuscule sans rien
// changer de ce qu'elle déclare.
const aplatir = (texte: string) => texte.replace(/\s+/g, " ").toLowerCase()

test("chaque nature de cible journalisée est énumérée sur /confidentialite", () => {
  const publie = aplatir(ligneDuJournal().data)
  const absentes = [...new Set(Object.values(AUDIT_CIBLE_NATURE))]
    .map((nom) => [nom, CIBLE_NATURES[nom]] as const)
    .filter(([, nature]) => "publiee" in nature && !publie.includes(aplatir(nature.publiee)))
    .map(([nom, nature]) => `${nom} → « ${(nature as { publiee: string }).publiee} »`)

  expect(
    absentes,
    "Le journal d'audit écrit une catégorie de données que /confidentialite " +
      "n'énumère pas. Le registre publié (`processings`, ligne `auditLog`) doit " +
      "reprendre MOT POUR MOT la phrase de chaque nature de `CIBLE_NATURES` " +
      "(`packages/backend/convex/_dataRegistry.ts`) qu'au moins une action " +
      "utilise. Reformuler la phrase est permis — des deux côtés ensemble ; " +
      "la faire disparaître d'un seul côté est ce que ce test refuse, parce " +
      "que ce journal n'est purgé par rien et que la personne concernée doit " +
      "pouvoir y retrouver sa situation.",
  ).toEqual([])
})

test("une nature déclarée que plus aucune action n'utilise n'est pas publiée", () => {
  // L'autre sens, et il compte autant : publier une catégorie que le
  // journal n'écrit plus décrit un traitement qui n'a pas lieu. Même
  // raisonnement que « chaque finalité publiée est portée par au moins une
  // table » plus haut.
  const utilisees = new Set<string>(Object.values(AUDIT_CIBLE_NATURE))
  expect(Object.keys(CIBLE_NATURES).filter((nom) => !utilisees.has(nom))).toEqual([])
})

test("une invitation jamais acceptée se retrouve dans le registre publié", () => {
  // Le cas qui coûte, vérifié pour lui-même : quelqu'un qui reçoit une
  // invitation et ne l'accepte JAMAIS voit son adresse écrite dans la
  // table dont la même ligne annonce « Conservé sans limite ». Il n'a
  // jamais eu de compte — donc aucune phrase parlant du « compte
  // concerné » ne le décrit, et il ne se cherchera pas là. La page doit
  // dire les deux choses, et dans cette ligne-ci : que l'adresse d'une
  // personne invitée y entre, et que ne pas accepter n'y change rien.
  const ligne = ligneDuJournal()
  const publie = aplatir(`${ligne.data} ${ligne.retention}`)
  expect(publie).toContain(aplatir(CIBLE_NATURES.emailDePersonneInvitee.publiee))
  expect(
    /n'accepte jamais|refus|jamais accept/.test(publie),
    "La ligne du journal doit dire qu'une invitation non acceptée laisse " +
      "quand même l'adresse dans un journal que rien ne purge : c'est la " +
      "seule situation où une personne sans aucun compte est conservée sans " +
      "limite, et elle ne se reconnaîtra dans aucune autre phrase.",
  ).toBe(true)
})

test("aucune nature ne publie une valeur de secret", () => {
  // Règle 3 de `convex/lib/auditEvent.ts` : aucune valeur de jeton
  // n'entre au journal, même tronquée. Le registre ne doit donc jamais
  // annoncer le contraire — une page qui déclarerait conserver la valeur
  // d'un secret serait fausse dans le sens le plus embarrassant.
  expect(aplatir(CIBLE_NATURES.nomDeJeton.publiee)).not.toContain("valeur")
  expect(aplatir(ligneDuJournal().data)).toContain("jamais sa valeur")
})

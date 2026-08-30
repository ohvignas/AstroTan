// Le classement de chaque table des deux schémas de ce dépôt, du point de
// vue du registre des traitements publié sur `/confidentialite`.
//
// Vit ici, à côté des schémas qu'il classe, plutôt que dans
// `apps/web/src/config/legal.ts` où le tableau publié est écrit : la
// vérification a besoin du schéma Better Auth, et `apps/web` n'a pas le
// droit de l'importer (invariant #1 — une règle ESLint le tient, et c'est
// elle qui a refusé la première version de ce garde-fou).
//
// Même rôle que `_registry.ts` pour les mutations, même raison d'être :
// une règle de relecture qu'un humain doit penser à appliquer a déjà
// échoué deux fois à la même place. `_dataRegistry.test.ts` la rend
// mécanique côté schéma ; `apps/web/src/config/legal.test.ts` vérifie
// l'autre moitié — que chaque table déclarée pointe une finalité qui est
// réellement publiée.
//
// Aucune fonction Convex ici : c'est un module de données, comme
// `_registry.ts`, et le bundler de déploiement s'en accommode pour la
// même raison.

import type { AuditAction } from "./lib/auditEvent"

/**
 * Chaque table des deux schémas, classée : rattachée à une finalité
 * publiée, ou exemptée AVEC SA RAISON.
 *
 * Le commentaire de `processings` décrit depuis longtemps la bonne règle de
 * relecture — ouvrir les deux schémas, vérifier que chaque table portant une
 * donnée qui désigne quelqu'un est couverte. Une règle qu'un humain doit
 * penser à appliquer a échoué deux fois, à la même place ; la seconde pour
 * `auditLog`, ajouté au schéma sans sa ligne. Cette liste est ce qui
 * transforme la règle en test (`legal.test.ts`), sur le modèle de
 * `MUTATION_REGISTRY` que le backend utilise déjà pour ses mutations.
 *
 * Une table nouvelle fait échouer la suite tant qu'elle n'est pas classée.
 * Elle peut l'être à tort — mais alors par écrit, et une exemption sans
 * raison est refusée par un test à part.
 */
export type TableCoverage =
  /** Le `purpose` EXACT de la ligne de `processings` qui couvre cette table. */
  | { declaredAs: string }
  /** Pourquoi cette table ne porte rien qui désigne une personne. */
  | { exempt: string }

export const TABLE_COVERAGE: Record<string, TableCoverage> = {
  // ── Ce qu'écrit un visiteur ──────────────────────────────────────────
  leads: { declaredAs: "Répondre à un message envoyé par le formulaire de contact" },
  leadMessages: { declaredAs: "Répondre à un message envoyé par le formulaire de contact" },
  leadEvents: { declaredAs: "Suivre, dans l'administration, le traitement d'une demande" },
  consentRecords: { declaredAs: "Enregistrer le choix exprimé sur les cookies" },

  // ── Les comptes d'administration ─────────────────────────────────────
  // `user` et `account` viennent du schéma Better Auth, `profiles` du nôtre :
  // trois tables, une seule finalité.
  user: { declaredAs: "Gérer les comptes de l'administration" },
  account: { declaredAs: "Gérer les comptes de l'administration" },
  profiles: { declaredAs: "Gérer les comptes de l'administration" },
  session: { declaredAs: "Ouvrir une session d'administration, et protéger cet accès" },
  invitations: { declaredAs: "Inviter une personne à rejoindre l'administration" },
  // Était exemptée, au motif que « rien n'y écrit jamais ». Ce motif est
  // devenu FAUX le jour où `auth.ts` a monté `sendResetPassword` : c'est
  // désormais là que Better Auth range le jeton de réinitialisation (son
  // empreinte, voir `verification.storeIdentifier` dans `auth.ts`) en face
  // de l'identifiant du compte concerné. Une ligne de cette table désigne
  // donc quelqu'un, et un champ qui désigne quelqu'un suffit.
  //
  // Ce n'est PAS `_dataRegistry.test.ts` qui l'aurait attrapé : il vérifie
  // qu'une table est classée, jamais que la raison de son exemption est
  // encore vraie. Une raison écrite un jour vieillit en silence — c'est le
  // mode d'échec propre à ce fichier, et le test ajouté à côté
  // (« `verification` reste déclarée tant que `sendResetPassword` est
  // monté ») est ce qui le ferme pour cette table-ci.
  verification: { declaredAs: "Réinitialiser le mot de passe d'un compte d'administration" },

  // ── Les gestes rattachés à leur auteur ───────────────────────────────
  pages: { declaredAs: "Savoir qui a publié, modifié ou téléversé quoi" },
  posts: { declaredAs: "Savoir qui a publié, modifié ou téléversé quoi" },
  redirects: { declaredAs: "Savoir qui a publié, modifié ou téléversé quoi" },
  media: { declaredAs: "Savoir qui a publié, modifié ou téléversé quoi" },
  // `majPar` désigne l'administrateur qui a enregistré le jeton. La valeur,
  // elle, est chiffrée et n'a rien de personnel.
  secrets: { declaredAs: "Savoir qui a publié, modifié ou téléversé quoi" },
  // `majPar` désigne l'administrateur qui a réécrit le texte d'un email ou
  // coupé son envoi. Le TEXTE, lui, n'est pas une donnée personnelle : il
  // est écrit par le déploiement, pas par la personne qui le recevra —
  // c'est `leads` qui porte ce qu'un visiteur a écrit. Déclarée, donc, et
  // jamais exemptée : un champ qui désigne quelqu'un suffit.
  emailTemplates: { declaredAs: "Savoir qui a publié, modifié ou téléversé quoi" },
  auditLog: { declaredAs: "Savoir qui a changé un rôle, un accès ou un réglage" },

  // ── Exemptées, et pourquoi ───────────────────────────────────────────
  tags: {
    exempt:
      "Un libellé et un slug de classement. Aucun champ ne désigne quelqu'un, " +
      "pas même son auteur.",
  },
  settings: {
    exempt:
      "Les réglages du site lui-même — nom, logo, adresse d'expédition des " +
      "e-mails, webhook. L'adresse d'expédition est celle du site, pas celle " +
      "d'une personne, et aucun champ ne rattache une ligne à quelqu'un.",
  },
  revalidationOutbox: {
    exempt:
      "De la mécanique de cache : des pointeurs vers des pages à réinvalider " +
      "et un compteur de tentatives. Aucun auteur, aucun destinataire.",
  },
  jwks: {
    exempt:
      "Les clés de signature des jetons Better Auth. Du matériel " +
      "cryptographique du déploiement, qui ne désigne aucune personne.",
  },
}

// ---------------------------------------------------------------------
// Le second maillon : la NATURE de ce que le journal d'audit écrit.
//
// `TABLE_COVERAGE` ci-dessus ferme une question — « cette table est-elle
// déclarée ? ». Il n'en ferme pas une autre, et c'est celle-là qui a
// dérivé : `auditLog` était bien déclarée, sa conservation bien annoncée
// « sans limite », et pourtant la phrase publiée en face du champ `data`
// n'énumérait plus que deux des catégories que le code y écrit. Trois
// actions ont été ajoutées à `AUDIT_ACTIONS` sans que rien ne rougisse —
// dont `invitation.create`, qui inscrit l'adresse d'une personne QUI N'A
// JAMAIS EU DE COMPTE dans la seule table que rien ne purge.
//
// LE PROBLÈME, ET POURQUOI CE FICHIER-CI. Une action est un identifiant
// (`invitation.create`) ; le registre est une phrase française. Rien ne
// les relie mécaniquement, et les deux tentatives évidentes échouent :
// exiger la chaîne `"invitation.create"` dans le texte publié donnerait
// une page illisible, et ne rien exiger ne protège de rien.
//
// LE MAILLON. Ce que le journal écrit en `cible` n'a qu'un petit nombre
// de NATURES — une adresse électronique, le nom d'un jeton, l'adresse
// d'une page, le titre d'un e-mail type, un identifiant interne. Ce sont
// ces natures que la page doit énumérer, jamais les actions : un lecteur
// ne cherche pas « `invitation.create` », il cherche « mon adresse ». La
// correspondance action → nature est déclarée ici, en un seul endroit, et
// chaque nature porte la phrase EXACTE qui doit figurer sur
// `/confidentialite`. Les deux tests s'y accrochent :
//
//   • `lib/auditEvent.test.ts` (backend) — toute action de `AUDIT_ACTIONS`
//     a une nature. Une action ajoutée sans nature fait rougir la suite.
//   • `apps/web/src/config/legal.test.ts` — la phrase de chaque nature
//     utilisée figure réellement dans le `data` publié. Une nature
//     déclarée que la page n'énumère pas fait rougir la suite.
//
// Ici plutôt que dans `lib/auditEvent.ts` : `apps/web` doit lire cette
// table pour tenir sa moitié du garde-fou, et `lib/auditEvent.ts` importe
// `convex/values` — donc le runtime serveur de Convex — que le bundle du
// site n'a rien à porter. `AuditAction` en `import type` seul : effacé au
// build (`verbatimModuleSyntax`), il ne fait entrer aucun code, et suffit
// à ce que `Record<AuditAction, …>` refuse à la compilation une action
// oubliée. Même frontière, même raison que pour le schéma Better Auth
// (invariant #1) — voir l'en-tête de ce fichier.
//
// CE QUE LE MAILLON NE VOIT PAS, et il faut le dire pour que l'absence se
// relise : il classe `cible`, pas `detail`. `detail` ne porte aujourd'hui
// que des mots choisis par le code — un nom de rôle, « création » ou
// « remplacement », « désactivé », une liste de noms de réglages —, jamais
// rien qui désigne quelqu'un. Le jour où un point d'écriture y mettrait
// une donnée personnelle, rien ici ne le signalerait.
// ---------------------------------------------------------------------

/**
 * Une nature de cible : ce qu'elle oblige la page à publier, ou pourquoi
 * il n'y a rien à publier.
 *
 * Même forme que `TableCoverage` ci-dessus, et pour la même raison : une
 * action qui ne vise personne doit pouvoir le dire, mais PAR ÉCRIT. Sans
 * le second cas, `sansCible` serait la porte de sortie silencieuse par
 * laquelle une action se soustrairait au registre.
 */
export type CibleNature =
  /** La phrase EXACTE qui doit figurer dans le `data` publié. */
  | { publiee: string }
  /** Pourquoi cette action n'écrit aucune cible. */
  | { sansCible: string }

export const CIBLE_NATURES = {
  /** `users.setRole`, `users.remove`, `passwordReset` — `target.email`. */
  emailDeCompte: {
    publiee: "l'adresse électronique du compte concerné",
  },
  /**
   * `invitations.create` — l'adresse de l'INVITÉ, écrite avant qu'aucun
   * compte n'existe. Une nature à part de `emailDeCompte`, et ce n'est pas
   * un raffinement : une personne qui n'accepte jamais l'invitation n'a
   * jamais de compte ici, et se cherchera sur la page sous « j'ai été
   * invité », jamais sous « mon compte ». Les confondre, c'est publier une
   * phrase où elle ne se reconnaît pas.
   */
  emailDePersonneInvitee: {
    publiee: "l'adresse électronique d'une personne invitée",
  },
  /** `secrets.set`/`clear` — `args.nom`. Jamais la valeur, pas même tronquée. */
  nomDeJeton: {
    publiee: "le nom d'un jeton d'accès",
  },
  /** `pages.*`/`posts.*` — le slug, qui est l'adresse publique. */
  adresseDePage: {
    publiee: "l'adresse d'une page ou d'un article",
  },
  /**
   * `emails.*` — `description.titre`, le titre du catalogue. Le TEXTE de
   * l'e-mail n'entre jamais dans la ligne (voir `emails.ts`) ; le titre,
   * lui, est écrit par le déploiement et ne désigne personne — mais il
   * s'énumère quand même, parce que le registre décrit ce que la table
   * contient, pas seulement ce qu'elle contient de personnel.
   */
  titreDEmail: {
    publiee: "le titre d'un e-mail type",
  },
  /**
   * `leads.remove` — l'identifiant Convex de la fiche, et rien d'autre :
   * y recopier l'adresse défairait l'effacement que la même page promet.
   */
  identifiantDeFiche: {
    publiee: "l'identifiant interne d'une fiche de contact",
  },
  /**
   * `resendDomain.declarer` — le nom de domaine d'expédition déclaré chez
   * Resend. Il ne désigne personne : c'est le domaine du site, celui qui
   * s'affiche déjà dans la barre d'adresse de chaque visiteur. Il
   * s'énumère quand même, parce que le registre décrit ce que la table
   * contient, pas seulement ce qu'elle contient de personnel.
   */
  nomDeDomaine: {
    publiee: "le nom de domaine d'expédition des e-mails",
  },
  /** `settings.update`. */
  aucune: {
    sansCible:
      "Le geste ne vise personne : la ligne ne porte que le nom des réglages " +
      "modifiés, jamais leur valeur, et aucun réglage n'est une personne.",
  },
} satisfies Record<string, CibleNature>

export type CibleNatureName = keyof typeof CIBLE_NATURES

/**
 * Chaque geste journalisé, en face de la nature de ce qu'il écrit en
 * `cible`. Dérivé des points d'écriture, un par un — la valeur passée à
 * `journaliser({ cible })`, pas ce qu'on aimerait qu'elle soit.
 *
 * `Record<AuditAction, …>` et non un objet libre : ajouter une valeur à
 * `AUDIT_ACTIONS` sans venir ici est une erreur de compilation, et
 * `lib/auditEvent.test.ts` la refait à l'exécution — `tsc` ne tourne pas
 * dans la boucle d'un test qui passe au vert.
 */
export const AUDIT_CIBLE_NATURE: Record<AuditAction, CibleNatureName> = {
  "role.change": "emailDeCompte",
  "user.remove": "emailDeCompte",
  "password.reset": "emailDeCompte",
  "invitation.create": "emailDePersonneInvitee",
  "secret.set": "nomDeJeton",
  "secret.clear": "nomDeJeton",
  "lead.remove": "identifiantDeFiche",
  "page.publish": "adresseDePage",
  "page.unpublish": "adresseDePage",
  "page.remove": "adresseDePage",
  "post.publish": "adresseDePage",
  "post.unpublish": "adresseDePage",
  "post.remove": "adresseDePage",
  "emailTemplate.set": "titreDEmail",
  "emailTemplate.toggle": "titreDEmail",
  "emailTemplate.reset": "titreDEmail",
  "settings.update": "aucune",
  "emailDomain.declare": "nomDeDomaine",
}

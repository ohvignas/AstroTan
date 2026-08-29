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

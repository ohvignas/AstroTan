// L'identité de l'éditeur du site, telle qu'elle apparaît sur les pages
// réglementaires.
//
// En code, dans un seul fichier, parce que ces valeurs sont les mêmes sur
// trois pages et qu'elles ne se recopient pas : une adresse changée à deux
// endroits sur trois est exactement le défaut que ce fichier existe pour
// rendre impossible.
//
// UN ADOPTANT DOIT REMPLIR CE FICHIER. Les valeurs livrées décrivent le
// dépôt AstroTan, pas son site — les laisser telles quelles publierait des
// mentions légales fausses, ce qui est pire que pas de mentions légales.

import { consentConfig } from "./consent"

export interface LegalEntity {
  /** Raison sociale, ou nom et prénom pour une personne physique. */
  name: string
  /** « SAS au capital de 1 000 € », « auto-entrepreneur », « association loi 1901 »… */
  form: string
  address: string
  email: string
  phone?: string
  /** SIRET, SIREN ou équivalent. Obligatoire pour une activité commerciale. */
  registration?: string
  /** Numéro de TVA intracommunautaire, si assujetti. */
  vat?: string
  /** Le directeur de la publication — une personne physique, nommée. */
  publicationDirector: string
}

export interface LegalHost {
  name: string
  address: string
  /** Site ou téléphone : la loi exige un moyen de le joindre. */
  contact: string
}

export const legalEntity: LegalEntity = {
  name: "AstroTan",
  form: "Projet open source — à remplacer par votre raison sociale",
  address: "Adresse à compléter",
  email: "contact@exemple.fr",
  publicationDirector: "À compléter",
}

export const legalHost: LegalHost = {
  name: "Hostinger International Ltd.",
  address: "61 Lordou Vironos Street, 6023 Larnaca, Chypre",
  contact: "https://www.hostinger.fr",
}

/**
 * Où les données partent, et pourquoi. Le tableau que le RGPD appelle
 * « registre » côté visiteur — la version lisible, pas le document interne.
 *
 * Une ligne par traitement réellement effectué. En retirer une parce qu'on
 * a retiré le traitement est normal ; en garder une pour faire sérieux est
 * une déclaration fausse.
 *
 * La réciproque coûte plus cher encore, et c'est elle qu'un audit a relevée
 * ici : une table qui stocke de la donnée personnelle sans ligne dans ce
 * tableau rend la page publiée fausse (articles 13 et 30). La règle de
 * relecture est donc mécanique — ouvrir `packages/backend/convex/schema.ts`
 * ET `packages/backend/convex/betterAuth/schema.ts`, et vérifier que chaque
 * table portant une donnée qui désigne quelqu'un est couverte par une ligne
 * ci-dessous. Une ligne par FINALITÉ, pas par table : plusieurs tables qui
 * servent le même but se déclarent ensemble.
 *
 * Ce qui est délibérément absent, pour que l'absence se relise :
 *   - `verification` (Better Auth) — ni vérification d'email ni
 *     réinitialisation de mot de passe ne sont branchées, rien n'y écrit ;
 *   - `pages`, `posts`, `tags`, `settings`, `redirects`,
 *     `revalidationOutbox` — du contenu et de la mécanique, sauf les champs
 *     `createdBy`/`updatedBy` qui désignent un administrateur, couverts par
 *     la dernière ligne.
 *
 * Sur les durées : n'écrire ici que ce que le code applique. Aucune purge
 * automatique n'existe aujourd'hui dans ce dépôt (`convex/crons.ts` ne
 * planifie que la relance du cache), et « 3 ans » écrit en face d'une table
 * que rien ne balaie est un engagement que personne ne tient. Le jour où une
 * purge est ajoutée, c'est ici que sa durée réelle vient s'écrire.
 */
export interface Processing {
  purpose: string
  data: string
  basis: string
  retention: string
  recipients: string
}

export const processings: Processing[] = [
  // ── Ce que fait un VISITEUR ────────────────────────────────────────────
  // Tables : `leads`, `leadMessages`.
  {
    purpose: "Répondre à un message envoyé par le formulaire de contact",
    data:
      "Nom, adresse électronique, sujet, contenu du message, dates du premier " +
      "et du dernier envoi, nombre de messages, et le « user-agent » — la " +
      "carte de visite que votre navigateur envoie à chaque requête. " +
      "S'ajoute une empreinte de votre adresse IP — le condensé de cette " +
      "adresse et d'un secret, jamais l'adresse elle-même — qui sert " +
      "uniquement à compter les envois et à arrêter les rafales " +
      "automatisées",
    basis: "Intérêt légitime — répondre à quelqu'un qui nous écrit",
    retention:
      "Jusqu'à la suppression de la fiche depuis l'administration. Aucune " +
      "purge automatique n'est en place aujourd'hui : rien ne supprime une " +
      "fiche que personne ne supprime.",
    recipients:
      "Convex, Inc. (hébergement de la base, États-Unis), et le service " +
      "d'automatisation configuré le cas échéant (webhook de lead)",
  },
  // Table : `leadEvents`.
  {
    purpose: "Suivre, dans l'administration, le traitement d'une demande",
    data:
      "Historique des déplacements de la fiche — statut d'origine, statut " +
      "d'arrivée, date — et le nom ainsi que l'identifiant de l'administrateur " +
      "auteur du geste, recopiés au moment où il est fait",
    basis:
      "Intérêt légitime — savoir depuis quand une demande attend, et qui l'a " +
      "traitée",
    retention:
      "Même sort que la fiche à laquelle l'historique se rattache : supprimé " +
      "avec elle, conservé tant qu'elle l'est",
    recipients: "Convex, Inc. (hébergement de la base, États-Unis)",
  },
  {
    purpose: "Mesurer l'audience du site",
    data:
      "Page vue, page d'origine, pays, type d'appareil — sans cookie. " +
      "L'adresse IP sert à en déduire le pays et l'identifiant de session, " +
      "puis n'est pas conservée.",
    basis: "Intérêt légitime — une mesure anonyme, exemptée de consentement",
    retention:
      "Aucune purge n'est configurée sur notre instance Umami : les " +
      "statistiques y restent tant que personne ne les supprime.",
    recipients: "Umami, auto-hébergé sur notre propre serveur",
  },
  // Table : `consentRecords` — écrite seulement si `traceability` est
  // activée dans `src/config/consent.ts` ET que `CONSENT_LOG_SECRET` est posé
  // des deux côtés ; sinon `/api/consent` répond 204 et n'écrit rien.
  {
    purpose: "Enregistrer le choix exprimé sur les cookies",
    data:
      "Le choix lui-même, sa date, la version de la politique acceptée, et un " +
      "identifiant d'appareil aléatoire",
    basis: "Obligation légale — pouvoir prouver le consentement",
    // La durée est LUE dans la configuration du bandeau plutôt que recopiée :
    // un adoptant qui passe `expirationDays` à 182 (la recommandation de la
    // CNIL) verrait sinon la page annoncer une durée que le site n'applique
    // plus, ce qui est précisément le genre d'écart que ce fichier existe
    // pour rendre impossible.
    retention:
      `Dans le navigateur : ${consentConfig.expirationDays} jours. En base, ` +
      "quand la traçabilité est activée : conservé sans limite, puisque c'est " +
      "la preuve qui est demandée.",
    recipients:
      "Personne, sauf si la traçabilité est activée — dans ce cas Convex, Inc. " +
      "(hébergement de la base, États-Unis)",
  },

  // ── Ce que fait un ADMINISTRATEUR ──────────────────────────────────────
  // Aucun visiteur n'est concerné par les quatre lignes suivantes. Elles
  // n'en sont pas moins dues : le RGPD ne distingue pas le public de
  // l'équipe, et un administrateur est une personne comme une autre.
  // Tables : `user` et `account` (Better Auth), `profiles`.
  {
    purpose: "Gérer les comptes de l'administration",
    data:
      "Nom, adresse électronique, rôle, état de bannissement et son motif, " +
      "empreinte du mot de passe, nom d'affichage et photo de profil",
    basis:
      "Intérêt légitime — permettre aux personnes autorisées d'administrer le " +
      "site, et à personne d'autre",
    retention: "Jusqu'à la suppression du compte",
    recipients: "Convex, Inc. (hébergement de la base, États-Unis)",
  },
  // Table `session` (Better Auth), plus les compteurs du composant
  // `@convex-dev/rate-limiter` — dont la clé est littéralement
  // `${ip}:${email}` (voir `convex/lib/signInRateLimit.ts`). C'est la ligne
  // que l'audit a jugée la plus grave : la page publiée affirmait ne
  // conserver aucune adresse IP alors que la base en garde une par session
  // d'administration ouverte.
  {
    purpose: "Ouvrir une session d'administration, et protéger cet accès",
    data:
      "Adresse IP et « user-agent » de chaque session ouverte, avec ses dates " +
      "de création et d'expiration ; compteurs de tentatives de connexion, " +
      "dont la clé associe une adresse IP et une adresse électronique",
    basis:
      "Intérêt légitime — sécurité de l'accès : reconnaître une session " +
      "ouverte, la révoquer, et arrêter une attaque par essais successifs",
    retention:
      "La session vit jusqu'à la déconnexion, sa révocation, ou son expiration " +
      "(durée par défaut de Better Auth, non modifiée ici). Rien ne supprime " +
      "ensuite la ligne expirée ni les compteurs de tentatives.",
    recipients: "Convex, Inc. (hébergement de la base, États-Unis)",
  },
  // Table : `invitations`. La ligne survit à l'acceptation (`accept` la
  // marque `acceptedAt`, seul `revoke` la supprime) — d'où la conservation
  // annoncée, qui décrit ce que le code fait et non ce qu'on aimerait.
  {
    purpose: "Inviter une personne à rejoindre l'administration",
    data:
      "Adresse électronique de l'invité, rôle proposé, identité de la personne " +
      "qui invite, empreinte du jeton d'invitation et sa date d'expiration",
    basis:
      "Intérêt légitime — l'accès est sur invitation seule, l'inscription " +
      "libre étant désactivée",
    retention:
      "L'invitation reste en base après avoir été acceptée, jusqu'à ce qu'elle " +
      "soit supprimée depuis l'administration",
    recipients:
      "Convex, Inc. (hébergement de la base, États-Unis), et Resend " +
      "(acheminement de l'e-mail d'invitation) lorsqu'une clé d'envoi est " +
      "configurée",
  },
  // Champs `createdBy`/`updatedBy` de `pages`, `posts`, `redirects`, et la
  // table `media`. Rien de tout cela n'est une table « de personnes », mais
  // chacun de ces champs désigne quelqu'un — ce qui suffit.
  {
    purpose: "Savoir qui a publié, modifié ou téléversé quoi",
    data:
      "Identifiant de l'administrateur qui a créé ou modifié une page, un " +
      "article, une redirection ou un fichier de la médiathèque, et le nom du " +
      "fichier téléversé",
    basis:
      "Intérêt légitime — rattacher une modification à son auteur, ce sans " +
      "quoi un site à plusieurs mains n'est pas relisible",
    retention: "Tant que le contenu concerné existe",
    recipients: "Convex, Inc. (hébergement de la base, États-Unis)",
  },
]

/** Le délégué à la protection des données, si le site en a désigné un. */
export const dpo: { name: string; email: string } | null = null

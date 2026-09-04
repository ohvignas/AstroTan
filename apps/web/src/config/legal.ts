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

// Le classement des tables du schéma vit dans `packages/backend`, à côté
// des schémas qu'il classe, et non ici : `apps/web` n'a pas le droit
// d'importer le schéma Better Auth (invariant #1, et une règle ESLint le
// tient). Réexporté pour que ce fichier reste le point d'entrée lisible du
// sujet « ce que le site déclare traiter ».
// `AUDIT_CIBLE_NATURE`/`CIBLE_NATURES` viennent du même module et pour la
// même raison : la correspondance « geste journalisé → nature de ce qu'il
// écrit » se déduit des points d'écriture, qui sont tous dans
// `packages/backend`. Elle est déclarée là-bas, publiée ici, et
// `legal.test.ts` vérifie que les deux disent la même chose.
export {
  AUDIT_CIBLE_NATURE,
  CIBLE_NATURES,
  TABLE_COVERAGE,
  type CibleNature,
  type CibleNatureName,
  type TableCoverage,
} from "@astrotan/backend/convex/_dataRegistry"

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

// =============================================================================
// À REMPLIR — c'est tout ce qu'il y a à remplir dans ce fichier.
//
// `legalEntity` et `legalHost` ci-dessous décrivent AstroTan, pas votre site.
// Rien après cette section (le registre des traitements, le DPO) n'a besoin
// d'être touché pour un site ordinaire — ce sont des mécanismes, pas une
// identité.
// =============================================================================

/**
 * Marqueur explicite : ce dépôt tourne encore avec l'identité d'exemple
 * d'AstroTan (raison sociale, adresse, hébergeur…), pas la vôtre.
 *
 * Deux garde-fous distincts en dépendent, et ils ne protègent pas la même
 * chose — les confondre a produit une première version de ce garde-fou qui
 * n'en tenait qu'un :
 *
 *   1. AU RENDU (le vrai verrou). Tant que ce marqueur vaut `true`,
 *      `/mentions-legales`, `/confidentialite` et `/cookies` ne publient
 *      JAMAIS `legalEntity` ni `legalHost` : `MentionsLegalesBody.astro`,
 *      `ConfidentialiteBody.astro` et `CookiesBody.astro` les remplacent
 *      par un avis explicite (`components/legal/LegalIdentityNotice.astro`,
 *      `LegalContactEmail.astro`) et les trois pages forcent `noindex`.
 *      C'est ce qui rend sûr de NE JAMAIS toucher ce fichier : un adoptant
 *      qui oublie qu'il existe ne publie pas pour autant une fausse
 *      identité — le site le lui dit, sur la page elle-même, sans qu'il
 *      ait besoin d'ouvrir une console ou ce fichier.
 *   2. AUX TESTS (le filet, une fois qu'on a commencé). `legal.test.ts`
 *      refuse les valeurs d'exemple dès que ce marqueur vaut `false` — donc
 *      dès que vous déclarez avoir personnalisé le site. Tant qu'il reste à
 *      `true`, ce test les tolère : c'est l'état normal du dépôt AstroTan
 *      lui-même, qui n'est le site de personne. Sans le (1), un marqueur
 *      resté à `true` par oubli aurait laissé les VRAIES pages publier
 *      « AstroTan » comme responsable de traitement — tests verts, CI
 *      verte, site en ligne avec une identité fausse. C'est exactement ce
 *      qu'un audit a trouvé dans la première version de ce fichier.
 *
 * Ce que ça veut dire pour vous, concrètement :
 *   1. Remplissez `legalEntity`, `legalHost`, et vérifiez `facts.ts` /
 *      `nav.ts` (repérés par le même garde-fou côté tests).
 *   2. Passez cette valeur à `false` — c'est ce qui fait apparaître votre
 *      identité sur les trois pages À LA PLACE de l'avis, et qui lève le
 *      `noindex` forcé.
 *   3. Lancez `pnpm test` : s'il reste une valeur d'exemple oubliée, le
 *      test échoue et la nomme. Continuez jusqu'au vert.
 *
 * Ne passez PAS ce marqueur à `false` avant l'étape 1 — le mettre à `false`
 * en premier est un moyen valide de s'en servir comme liste de tâches (le
 * test rougit et énumère ce qu'il reste à faire, ET les pages se mettent à
 * afficher les avis « non renseigné » à la place des valeurs d'exemple),
 * mais un `false` qui reste accompagné de valeurs d'exemple est un échec du
 * test, pas un contournement possible : il n'existe aucune combinaison des
 * deux qui passe au vert sans que les valeurs d'exemple aient réellement
 * disparu.
 */
export const ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED = true

export const legalEntity: LegalEntity = {
  name: "AstroTan",
  form: "Projet open source — à remplacer par votre raison sociale",
  address: "Adresse à compléter",
  email: "contact@exemple.fr",
  publicationDirector: "À compléter",
}

// L'hébergeur, et pourquoi ce template ne le devine pas à votre place.
//
// Ces trois champs nommaient Hostinger : raison sociale complète, adresse à
// Larnaca, URL qui répond. C'était l'hébergeur de l'auteur, recopié une
// fois — et c'est la seule valeur de cette section qui se lisait comme
// DÉJÀ REMPLIE, quand les quatre autres s'annoncent (« à compléter »,
// « à remplacer par votre raison sociale »). Un adoptant qui déploie sur
// OVH, Scaleway ou Hetzner parcourait ce fichier en cherchant ce qui reste
// à faire et passait devant sans s'arrêter.
//
// C'est le pire champ où le faire. L'hébergeur est une mention obligatoire
// (LCEN art. 6-III), et c'est la seule que ce template ne peut
// structurellement pas connaître : elle désigne une machine qu'il ne
// fournit pas. Rien ici n'en dépend — `docker/`, Traefik, le compose et les
// workflows décrivent un VPS Docker quelconque. Il n'y a donc pas
// d'« hébergeur de référence » à préserver.
//
// Un garde-fou tient désormais la règle plutôt que ce commentaire
// (`legal.test.ts` : « le template ne livre aucune identité légale qui
// puisse passer pour vraie ») : tant que le marqueur ci-dessus vaut `true`,
// aucun champ d'identité livré ne peut nommer un tiers.
//
// À REMPLIR : le nom, l'adresse postale et un moyen de joindre l'entreprise
// qui héberge réellement ce site — celle dont vous louez la machine ou le
// service. Ces valeurs se trouvent sur son site ou dans votre contrat.
export const legalHost: LegalHost = {
  name: "Hébergeur à compléter",
  address: "Adresse de l'hébergeur à compléter",
  contact: "Site ou téléphone de l'hébergeur à compléter",
}

// =============================================================================
// Ce qui suit décrit un MÉCANISME (le registre des traitements, le DPO), pas
// une identité. Un site ordinaire n'a rien à y changer — sauf `dpo` si vous
// en désignez un, et le tableau `processings` si vous ajoutez ou retirez un
// traitement de données réel (voir le commentaire de `Processing`).
// =============================================================================

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
 *   - `pages`, `posts`, `tags`, `settings`, `redirects`,
 *     `revalidationOutbox` — du contenu et de la mécanique, sauf les champs
 *     `createdBy`/`updatedBy` qui désignent un administrateur, couverts par
 *     la dernière ligne.
 *
 * Sur les durées : n'écrire ici que ce que le code applique. Une durée
 * écrite en face d'une table que rien ne balaie est un engagement que
 * personne ne tient. `retention.ts` (Convex) tient cette promesse pour les
 * tables Convex — `leads`, `consentRecords` — sur un cron mensuel
 * (`convex/crons.ts`). Umami échappe à ce cron : il vit dans son propre
 * PostgreSQL, hors de portée de tout code Convex, et sa purge est un
 * service Docker à part (`docker/docker-compose.yml`, service
 * `umami-purge` ; détail dans `docker/README.md` §13.10). Le jour où une
 * durée change d'un côté ou de l'autre, c'est ici que sa valeur réelle
 * vient s'écrire.
 *
 * Et ce n'est pas laissé à la vigilance : `legal.test.ts` relit
 * `packages/backend/convex/retention.ts` et `docker/umami-purge.sql`, et
 * refuse toute durée publiée ici qui ne serait pas celle appliquée là-bas.
 * Les deux entrées les plus anciennes de ce tableau — les fiches de contact
 * et les preuves de consentement — avaient précisément dérivé, en affirmant
 * qu'aucune purge n'existait alors que le cron en exécutait une depuis un
 * lot.
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
      "Nom, adresse électronique, numéro de téléphone, sujet, contenu du " +
      "message, dates du premier et du dernier envoi, nombre de messages, et " +
      "le « user-agent » — la " +
      "carte de visite que votre navigateur envoie à chaque requête. " +
      "S'ajoute l'adresse IP, le pays et la ville s'ils sont connus — " +
      "visibles seulement dans l'administration, jamais dans une query " +
      "publique. Une empreinte de cette adresse — le condensé de l'adresse " +
      "et d'un secret — sert uniquement à compter les envois et à arrêter " +
      "les rafales automatisées",
    basis: "Intérêt légitime — répondre à quelqu'un qui nous écrit",
    // La durée est celle de `LEAD_RETENTION_DAYS`
    // (`packages/backend/convex/retention.ts`), recopiée ici — `apps/web`
    // ne peut pas l'importer sans faire entrer le runtime serveur de Convex
    // dans le bundle du site. Ce que la recopie coûte, `legal.test.ts` le
    // rembourse : il relit `retention.ts` et refuse toute divergence. Le
    // nombre de JOURS est écrit en clair pour cette raison — « 3 ans » seul
    // se compare mal à `3 * 365`, et c'est cette approximation qui laisse
    // dériver.
    retention:
      "3 ans après le dernier message reçu — 1095 jours exactement, " +
      "appliqués par une purge automatique mensuelle qui supprime la fiche " +
      "avec tout son historique. Avant ce terme, une suppression depuis " +
      "l'administration l'efface immédiatement.",
    recipients:
      "Convex, Inc. (hébergement de la base, États-Unis), et le service " +
      "d'automatisation configuré le cas échéant (webhook de lead)",
  },
  // Tables : `chatSessions`, `chatPresence`, et le thread du composant Agent.
  {
    purpose:
      "Répondre, dans le chat du site, aux questions d'un visiteur et qualifier sa demande",
    data:
      "Adresse électronique, nom le cas échéant, contenu des messages, " +
      "horodatages, identifiant de fil, adresse IP, pays et ville s'ils " +
      "sont connus — visibles seulement dans l'administration —, empreinte " +
      "d'origine — le condensé de l'adresse IP et d'un secret —, et le " +
      "user-agent s'il est transmis. L'adresse électronique figure aussi " +
      "en titre du fil côté assistant",
    basis: "Intérêt légitime — répondre à quelqu'un qui nous écrit",
    // Même durée que la fiche : le fil part avec elle, via
    // `deleteLeadCascade`. `legal.test.ts` relit `LEAD_RETENTION_DAYS`.
    retention:
      "3 ans après le dernier message reçu — 1095 jours exactement, " +
      "appliqués par une purge automatique mensuelle qui supprime la fiche " +
      "avec tout son historique. Avant ce terme, une suppression depuis " +
      "l'administration l'efface immédiatement.",
    recipients:
      "Convex, Inc. (hébergement de la base, États-Unis) ; OpenRouter, Inc. " +
      "(acheminement des réponses de l'assistant) ; et, le cas échéant, les " +
      "services que le responsable a connectés depuis l'administration " +
      "(agenda, serveurs d'assistance)",
  },
  // Table : `purchases`.
  {
    purpose: "Encaisser le paiement unique de l'offre Complet",
    data:
      "Identifiant de session Stripe, montant et devise figés côté serveur " +
      "(9,99 €), statut du paiement, date, et l'adresse électronique que " +
      "Stripe renvoie après encaissement — jamais un champ libre du site",
    basis: "Exécution du contrat — fournir l'offre payée",
    retention:
      "Conservé le temps de la relation commerciale et des obligations " +
      "comptables. Une suppression depuis l'administration l'efface de la " +
      "base ; la pièce chez Stripe suit leurs propres durées.",
    recipients:
      "Convex, Inc. (hébergement de la base, États-Unis) et Stripe, Inc. " +
      "(encaissement, États-Unis / Irlande)",
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
      "13 mois : une purge mensuelle supprime, sur notre instance Umami, " +
      "toute mesure plus ancienne — pages vues, replays, données " +
      "d'événement. Une session n'est retirée qu'une fois disparue la " +
      "dernière mesure qui s'y rattache, ce qui peut la conserver quelques " +
      "semaines de plus.",
    recipients: "Umami, auto-hébergé sur notre propre serveur",
  },
  // Table : `consentRecords` — écrite seulement si `traceability` est
  // activée dans `src/config/consent.ts` ET que `CONSENT_LOG_SECRET` est posé
  // des deux côtés ; sinon `/api/consent` répond 204 et n'écrit rien.
  {
    purpose: "Enregistrer le choix exprimé sur les cookies",
    data:
      "Le choix lui-même, sa date, la version de la politique acceptée, et un " +
      "identifiant d'appareil aléatoire. S'ajoute une empreinte de votre " +
      "adresse IP — le condensé de cette adresse et d'un secret, jamais " +
      "l'adresse elle-même — qui sert uniquement à limiter le nombre " +
      "d'enregistrements et à arrêter les rafales automatisées",
    basis: "Obligation légale — pouvoir prouver le consentement",
    // La durée est LUE dans la configuration du bandeau plutôt que recopiée :
    // un adoptant qui passe `expirationDays` à 182 (la recommandation de la
    // CNIL) verrait sinon la page annoncer une durée que le site n'applique
    // plus, ce qui est précisément le genre d'écart que ce fichier existe
    // pour rendre impossible.
    // La durée en base est celle de `CONSENT_RETENTION_DAYS`
    // (`packages/backend/convex/retention.ts`), et elle doit rester égale à
    // `expirationDays` ci-dessus : une preuve purgée avant l'expiration du
    // cookie laisserait un visiteur porteur d'un consentement valide que
    // plus rien n'atteste. `legal.test.ts` vérifie les deux égalités.
    retention:
      `Dans le navigateur : ${consentConfig.expirationDays} jours. En base, ` +
      "quand la traçabilité est activée : 365 jours, puis une purge " +
      "automatique mensuelle supprime la preuve. C'est la durée de validité " +
      "du consentement lui-même : passé ce délai le bandeau redemande son " +
      "avis, et l'ancienne réponse n'autorise plus rien.",
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
      "empreinte du mot de passe, nom d'affichage et photo de profil ; " +
      "préférences de notification (cloche, e-mail) ; lignes de cloche " +
      "(destinataire, type, libellé, identifiant de cible)",
    basis:
      "Intérêt légitime — permettre aux personnes autorisées d'administrer le " +
      "site, et à personne d'autre",
    retention:
      "Jusqu'à la suppression du compte — pour les tables de comptes et les " +
      "préférences de notification. Les lignes de cloche partent avec le " +
      "compte, et au-delà au bout de 90 jours. Le journal d'administration, " +
      "décrit plus bas, conserve toutefois sans limite l'adresse électronique " +
      "d'un compte dont le rôle a changé ou qui a été supprimé : supprimer un " +
      "compte ne l'efface donc pas de ce journal.",
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
  // Table : `verification` (Better Auth). Elle était déclarée absente de ce
  // tableau tant que rien n'y écrivait ; `auth.ts` monte désormais
  // `sendResetPassword`, et c'est là que le jeton de réinitialisation est
  // rangé en face du compte qu'il ouvre.
  {
    purpose: "Réinitialiser le mot de passe d'un compte d'administration",
    data:
      "L'empreinte du lien de réinitialisation envoyé par e-mail — jamais le " +
      "lien lui-même —, l'identifiant du compte qu'il ouvre, et sa date " +
      "d'expiration",
    basis:
      "Intérêt légitime — l'accès étant sur invitation seule, c'est le seul " +
      "moyen de reprendre la main sur un compte dont le mot de passe est perdu",
    retention:
      "Une heure au plus : le lien expire au bout d'une heure, et la ligne est " +
      "supprimée dès qu'il est utilisé. Les liens expirés sans avoir servi sont " +
      "effacés à la demande suivante, quelle qu'elle soit.",
    recipients:
      "Convex, Inc. (hébergement de la base, États-Unis), et Resend " +
      "(acheminement de l'e-mail) lorsqu'une clé d'envoi est configurée",
  },
  // Champs `createdBy`/`updatedBy` de `pages`, `posts`, `redirects`, la table
  // `media`, et le champ `majPar` de `secrets` et d'`emailTemplates`. Rien de
  // tout cela n'est une table « de personnes », mais chacun de ces champs
  // désigne quelqu'un — ce qui suffit. `secrets.majPar` a été ajouté ici parce
  // que le garde-fou de `legal.test.ts` a refusé de le laisser non classé : la
  // table existait depuis le lot des réglages sans qu'aucune ligne ne la
  // couvre. `emailTemplates.majPar` a suivi le même chemin, cette fois avant
  // que la table n'existe.
  {
    purpose: "Savoir qui a publié, modifié ou téléversé quoi",
    data:
      "Identifiant de l'administrateur qui a créé ou modifié une page, un " +
      "article, une redirection ou un fichier de la médiathèque, qui a " +
      "enregistré un jeton d'accès à un service tiers, ou qui a réécrit le " +
      "texte d'un e-mail envoyé par le site — et le nom du fichier " +
      "téléversé",
    basis:
      "Intérêt légitime — rattacher une modification à son auteur, ce sans " +
      "quoi un site à plusieurs mains n'est pas relisible",
    retention: "Tant que le contenu concerné existe",
    recipients: "Convex, Inc. (hébergement de la base, États-Unis)",
  },
  // Table : `auditLog`. Écrite par `lib/auditEvent.ts`, dans la mutation même
  // qui accomplit le geste.
  //
  // L'énumération de `data` ci-dessous n'est PAS libre : chaque catégorie y
  // reprend mot pour mot la phrase d'une nature de
  // `AUDIT_CIBLE_NATURE`/`CIBLE_NATURES` (`convex/_dataRegistry.ts`), et
  // `legal.test.ts` refuse qu'une nature journalisée manque ici. C'est ce
  // qui a fermé le défaut : trois actions avaient été ajoutées à
  // `AUDIT_ACTIONS` — dont l'invitation, qui écrit l'adresse de l'invité —
  // pendant que cette phrase n'énumérait toujours que le changement de rôle
  // et la suppression de compte. Reformuler est permis ; faire disparaître
  // une catégorie ne l'est pas.
  {
    purpose: "Savoir qui a changé un rôle, un accès ou un réglage",
    data:
      "Le nom d'affichage et l'identifiant de l'administrateur auteur du " +
      "geste, recopiés au moment où il est fait ; la nature du geste ; et ce " +
      "qu'il visait — selon le geste : l'adresse électronique du compte " +
      "concerné (changement de rôle, suppression de compte, réinitialisation " +
      "de mot de passe) ; l'adresse électronique d'une personne invitée à " +
      "rejoindre l'administration, y compris si elle n'accepte jamais " +
      "l'invitation et n'a donc jamais de compte ici ; le nom d'un jeton " +
      "d'accès (jamais sa valeur, pas même tronquée) ; l'adresse d'une page " +
      "ou d'un article publié, dépublié ou supprimé ; le titre d'un e-mail " +
      "type dont le texte ou l'envoi a été modifié (jamais son contenu) ; le " +
      "nom de domaine d'expédition des e-mails déclaré chez le service " +
      "d'envoi ; ou " +
      "l'identifiant interne d'une fiche de contact supprimée — jamais " +
      "l'adresse ni le nom de la personne qui l'avait écrite, pour que ce " +
      "journal ne défasse pas l'effacement de la fiche",
    basis:
      "Intérêt légitime — sécurité : pouvoir dire qui a changé un rôle, écrit " +
      "un jeton d'accès ou retiré une page du site, ce qu'aucune autre donnée " +
      "conservée ne permet de reconstituer après coup",
    retention:
      "Conservé sans limite. Rien ne purge ce journal, et c'est délibéré : un " +
      "journal qu'on efface à volonté ne prouve plus rien. La suppression d'un " +
      "compte d'administration ne retire donc pas les lignes qui le nomment, " +
      "et une invitation refusée, expirée ou révoquée n'en retire pas non " +
      "plus l'adresse invitée.",
    recipients: "Convex, Inc. (hébergement de la base, États-Unis)",
  },
]

/** Le délégué à la protection des données, si le site en a désigné un. */
export const dpo: { name: string; email: string } | null = null

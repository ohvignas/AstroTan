// Le catalogue des emails que ce dépôt envoie, décrit à un seul endroit.
//
// Deux envois aujourd'hui : `invitations.sendInvitationEmail` et
// `leads.notifyStaff`. Better Auth n'en envoie aucun — `auth.ts` ne monte ni
// `sendResetPassword`, ni `emailVerification.sendVerificationEmail`, ni les
// plugins `magicLink`/`emailOTP` ; son propre commentaire (ligne ~655) le dit
// déjà. Un troisième envoi qui apparaîtrait un jour dans le code sans être
// ajouté ici ferait échouer le premier test de `catalogueEmails.test.ts` —
// c'est voulu, c'est le rappel.
//
// L'écran d'administration, sa validation et le rendu des gabarits lisent
// tous `CATALOGUE` : ajouter un troisième email un jour est UN endroit à
// modifier, pas trois.

/** Les deux emails que ce dépôt envoie, et rien d'autre. */
export type CleEmail = "invitation" | "leadNotification"

export interface DescriptionEmail {
  cle: CleEmail
  titre: string
  quand: string
  destinataire: string
  /** Faux quand couper cet email fermerait la porte à quelqu'un. */
  desactivable: boolean
  /** La raison, affichée à l'écran, quand `desactivable` est faux. */
  raisonNonDesactivable?: string
  variables: readonly string[]
  variablesObligatoires: readonly string[]
  objetParDefaut: string
  corpsParDefaut: string
}

export const CATALOGUE: readonly DescriptionEmail[] = [
  {
    cle: "invitation",
    titre: "Invitation à rejoindre l'administration",
    quand: "Quand un owner ou un admin invite quelqu'un depuis l'écran des utilisateurs.",
    destinataire: "La personne invitée, à l'adresse saisie par qui l'invite.",
    // Non désactivable : trois faits indépendants, chacun suffisant seul.
    //
    // 1. L'invitation est le SEUL chemin de création de compte de ce
    //    dépôt — `auth.ts` monte `emailAndPassword` avec `disableSignUp:
    //    true` et aucune inscription libre, aucun OAuth. La couper, c'est
    //    fermer la seule porte d'entrée, sans en laisser une autre ouverte.
    // 2. Le jeton en clair n'existe qu'une fois : `sendInvitationEmail`
    //    (`invitations.ts`) l'efface de la base (`claimPendingToken`) AVANT
    //    même de tenter l'envoi. Un interrupteur qui empêcherait cet appel
    //    ne laisserait pas un email en attente qu'on pourrait renvoyer plus
    //    tard — il ferait disparaître le seul moyen d'accepter l'invitation,
    //    définitivement.
    // 3. Il n'existe aucune action « renvoyer » : rater ce seul envoi (email
    //    désactivé, ou service en panne au mauvais moment) laisse la
    //    personne invitée sans recours et sans que qui que ce soit d'autre
    //    ne puisse le déclencher à nouveau.
    // Un interrupteur ici ne serait pas une préférence d'affichage, ce
    // serait un verrouillage à retardement — le genre d'action qu'on ne
    // découvre irréversible qu'au moment où on la regrette.
    desactivable: false,
    raisonNonDesactivable:
      "L'invitation est le seul chemin de création de compte de ce dépôt (aucune inscription " +
      "libre, aucun OAuth). Son jeton en clair est effacé de la base avant même que l'envoi ne " +
      "soit tenté, et il n'existe aucune action « renvoyer » : la désactiver fermerait cette " +
      "porte sans recours.",
    variables: ["lien"],
    variablesObligatoires: ["lien"],
    // Copie exacte d'`invitations.ts:264` (`subject`) — aucune
    // interpolation à convertir.
    objetParDefaut: "Invitation à rejoindre AstroTan",
    // Copie exacte d'`invitations.ts:266` (`text`), seule interpolation
    // (`${link}`) convertie en `{{lien}}`.
    corpsParDefaut: "Vous avez été invité·e à rejoindre AstroTan : {{lien}}",
  },
  {
    cle: "leadNotification",
    titre: "Nouveau message de contact",
    quand: "Quand quelqu'un envoie le formulaire de contact du site public.",
    destinataire: "Chaque owner et admin du déploiement, un email par personne.",
    desactivable: true,
    variables: ["nom", "email", "sujet", "message", "lien"],
    // Aucune obligatoire : la notification reste lisible amputée d'une
    // variable — contrairement au lien de l'invitation, rien ici n'ouvre
    // une porte que son absence fermerait.
    variablesObligatoires: [],
    // Copie exacte de `leads.ts:773` (`subject`, via `singleLine`), avec
    // `${name}` converti en `{{nom}}`.
    objetParDefaut: "Nouveau message de {{nom}}",
    // Copie exacte de `leads.ts:741-750` (le tableau `text`, joint par
    // `\n`), interpolations converties en `{{variable}}`. La ligne de
    // relance (`args.messageCount > 1 ? ... : null`) est omise : elle ne
    // dépend d'aucune des variables déclarées ci-dessus (`messageCount`
    // n'en est pas une) et reste une décision du serveur, pas un texte que
    // ce catalogue expose à la modification.
    corpsParDefaut: [
      "{{nom}} <{{email}}> a écrit depuis le formulaire de contact.",
      "",
      "Sujet : {{sujet}}",
      "",
      "{{message}}",
      "",
      "Répondre depuis le dashboard : {{lien}}",
    ].join("\n"),
  },
]

import { v } from "convex/values"
import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import type { QueryCtx } from "./_generated/server"
import { components, internal } from "./_generated/api"
import { isCurrentlyBanned } from "./lib/authz"
import { journaliser } from "./lib/auditEvent"
import { makeResend } from "./lib/resend"
import { resoudreExpediteur } from "./lib/expediteur"
import { rendreHtml, rendreTexte, singleLine } from "./lib/gabarit"

// ---------------------------------------------------------------------
// La récupération de mot de passe : le seul chemin de retour dans un
// déploiement où l'inscription est fermée (`disableSignUp: true`, aucun
// OAuth). Sans elle, un adoptant qui perd son mot de passe perd son
// application.
//
// Ce module ne décide de RIEN sur l'authentification elle-même : Better
// Auth émet le jeton, le vérifie et réécrit l'empreinte du mot de passe.
// Il porte les trois choses que Better Auth ne fait pas, et que sa
// configuration par défaut laisse ouvertes :
//
//   1. **L'envoi**, hors du chemin de la requête. `auth.ts` planifie
//      `envoyer` sans jamais attendre l'email lui-même : attendre
//      allongerait la réponse quand — et seulement quand — le compte
//      existe, ce qui en ferait un oracle mesurable au chronomètre, quelle
//      que soit la prudence du corps de réponse.
//   2. **Le refus d'un compte suspendu**, EN SILENCE. Rien dans
//      `/request-password-reset` ne consulte `banned` (vérifié dans
//      `better-auth@1.6.17`'s `api/routes/password.mjs` : la route ne fait
//      qu'un `findUserByEmail`), si bien qu'un compte qu'on vient de
//      couper pouvait revenir par cette porte. Le refus se fait ICI et pas
//      dans la route, précisément pour qu'il n'ait aucune conséquence
//      visible : la réponse HTTP est déjà partie, identique à celle d'une
//      adresse inconnue.
//   3. **La trace au journal**, écrite quand le mot de passe A CHANGÉ, pas
//      quand quelqu'un a demandé à le changer — voir
//      `journaliserReinitialisation` plus bas.
//
// Aucune fonction publique ici : `/request-password-reset` et
// `/reset-password` sont les deux seules portes, et elles sont servies par
// Better Auth dans `http.ts`. Un `_registry.ts` ne réclame donc rien de ce
// module (son test ne recense que les `mutation`/`action` PUBLIQUES).
// ---------------------------------------------------------------------

/**
 * L'état « suspendu » du compte portant cette adresse, ou `false` quand
 * l'adresse n'a pas de compte du tout.
 *
 * Les deux cas se répondent volontairement pareil du point de vue de
 * l'appelant — « il n'y a rien à envoyer » — parce que c'est exactement ce
 * qu'ils ont en commun, et que les distinguer ici n'apporterait qu'une
 * occasion de laisser la différence ressortir plus haut.
 *
 * Le rôle vit sur l'utilisateur Better Auth (invariant 4), donc la table
 * `user` est dans un composant et n'est pas interrogeable par `ctx.db` :
 * `adapter.findOne` est la seule voie, comme `invitations.create` le fait
 * déjà pour la même table.
 */
async function envoiInterdit(ctx: QueryCtx, email: string): Promise<boolean> {
  const doc = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user" as const,
    where: [{ field: "email" as const, operator: "eq" as const, value: email }],
  })
  if (!doc) return true
  // `isCurrentlyBanned` (`lib/authz.ts`) est la SEULE définition de
  // « suspendu » de ce dépôt, et elle est déjà celle que `requireRole`
  // applique à chaque appel authentifié. En réécrire une seconde ici — ne
  // serait-ce qu'un `doc.banned === true` — ferait diverger la porte
  // d'entrée du reste : un ban dont `banExpires` est passé est un ban
  // LEVÉ, et refuser la réinitialisation dans ce cas enfermerait quelqu'un
  // dont la sanction est terminée.
  return isCurrentlyBanned({
    banned: typeof doc.banned === "boolean" ? doc.banned : null,
    banExpires: typeof doc.banExpires === "number" ? doc.banExpires : null,
  })
}

/** La même décision, atteignable depuis l'action qui envoie. */
export const envoiInterditPour = internalQuery({
  args: { email: v.string() },
  handler: (ctx, args) => envoiInterdit(ctx, args.email),
})

/**
 * L'envoi, planifié par `sendResetPassword` (voir `auth.ts`).
 *
 * Une `action` et non une `mutation` : `resend.sendEmail` doit pouvoir
 * échouer (pas de clé API, panne réseau…) sans annuler quoi que ce soit —
 * le jeton, lui, est déjà écrit en base par Better Auth, dans une
 * transaction que celle-ci ne partage pas.
 *
 * Le lien arrive tout construit plutôt que le jeton : c'est la seule
 * différence de forme avec `sendInvitationEmail`, et elle est sans effet
 * sur ce que `_scheduled_functions` retient — un lien contient son jeton.
 * `invitations.ts` refuse de faire passer son jeton par les arguments du
 * planificateur, et le raisonnement n'a pas changé ; ce qui a changé, ce
 * sont les durées : un jeton d'invitation vit SEPT JOURS et peut être mis
 * en scène dans une ligne qu'on contrôle (`pendingToken`), là où celui-ci
 * vit UNE HEURE et n'existe qu'en mémoire au moment où Better Auth nous le
 * passe — la table `verification` n'en garde que l'empreinte (voir
 * `auth.ts`, `verification.storeIdentifier`), donc rien ne permettrait de
 * le relire ensuite. L'exposition est bornée par la validité du jeton
 * lui-même, et elle est réservée à qui tient déjà les clés du déploiement.
 */
export const envoyer = internalAction({
  args: { email: v.string(), lien: v.string() },
  handler: async (ctx, args) => {
    // Refus SILENCIEUX : ni erreur, ni journal, ni différence visible. La
    // réponse HTTP est partie depuis longtemps — c'est tout l'intérêt de
    // décider ici plutôt que dans la route.
    if (await ctx.runQuery(internal.passwordReset.envoiInterditPour, { email: args.email })) {
      return
    }

    // Le texte vient de l'écran « envoi des emails », ou du catalogue quand
    // personne n'y a touché — `gabaritPour` décide, et il est le SEUL à
    // décider (voir l'en-tête d'`emails.ts`). Il revalide déjà la ligne
    // enregistrée avant de la rendre, si bien qu'un gabarit devenu invalide
    // fait retomber l'envoi sur le littéral du code au lieu de l'arrêter.
    //
    // Aucune lecture d'`actif` : cet email n'est pas désactivable (voir
    // `lib/catalogueEmails.ts`), et c'est le dernier chemin de récupération
    // du dépôt. Un interrupteur consulté ici — même un qui ne devrait
    // jamais valoir faux — enfermerait quelqu'un le jour où une ligne
    // arriverait par une restauration de sauvegarde.
    const gabarit = await ctx.runQuery(internal.emails.gabarit, { cle: "passwordReset" })
    const valeurs = { lien: args.lien }

    const resend = await makeResend(ctx)
    await resend.sendEmail(ctx, {
      from: await resoudreExpediteur(ctx),
      to: args.email,
      // `singleLine` APRÈS le rendu : `validerGabarit` garantit que le
      // GABARIT de l'objet tient sur une ligne, jamais ce que les valeurs
      // y injectent. Même geste que les deux autres envois du dépôt, pour
      // qu'ils se relisent pareil.
      subject: singleLine(rendreTexte(gabarit.objet, valeurs)),
      html: `<p style="white-space:pre-wrap">${rendreHtml(gabarit.corps, valeurs)}</p>`,
      text: rendreTexte(gabarit.corps, valeurs),
    })
  },
})

/**
 * La ligne de journal, écrite quand le mot de passe A CHANGÉ.
 *
 * Appelée par `onPasswordReset` (`auth.ts`), donc APRÈS que Better Auth a
 * réécrit l'empreinte — jamais depuis `/request-password-reset`, qui est
 * ouvert à Internet : journaliser une simple demande laisserait n'importe
 * qui gonfler le journal, et y faire écrire des adresses qui n'ont pas de
 * compte.
 *
 * L'acteur est la personne elle-même. C'est le seul geste journalisé de ce
 * dépôt dont l'auteur n'est pas une session authentifiée — et c'est
 * précisément pour ça qu'il vaut d'être écrit : le changement de mot de
 * passe par jeton est le seul chemin qui modifie un accès sans qu'aucune
 * session ne l'ait demandé, donc le seul qu'aucune autre donnée conservée
 * ne permettrait de reconstituer.
 *
 * Ni le jeton ni le mot de passe n'entrent ici, ni tronqués ni hachés —
 * règle 3 de `lib/auditEvent.ts`. Il n'y a rien à en dire que « il a
 * changé ».
 */
export const journaliserReinitialisation = internalMutation({
  args: { authUserId: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    await journaliser(ctx, {
      acteur: { _id: args.authUserId, email: args.email },
      action: "password.reset",
      cible: args.email,
    })
  },
})

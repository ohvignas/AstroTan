// Le droit d'accès et le droit à la portabilité, rendus exécutables.
//
// `/confidentialite` promet l'accès, la rectification, l'effacement et la
// portabilité. Le dépôt savait EFFACER (`leads.remove`, `users.remove`) et
// rien d'autre : répondre à une demande d'accès se serait fait à la main,
// dans le tableau de bord Convex, table par table, en espérant n'en oublier
// aucune. Une promesse tenue à la main est une promesse tenue jusqu'au jour
// où elle ne l'est pas.
//
// Fonctions d'exploitation, sur le modèle de `bootstrap:createInvitation` et
// `seed:demoContent` : `internalQuery`, donc inatteignables depuis un
// client, seulement par
//
//     npx convex run dataSubject:exportByEmail '{"email":"…"}'
//     npx convex run dataSubject:exportByVisitor '{"visitorId":"…"}'
//
// qui exige déjà les identifiants du déploiement. Quelqu'un qui les détient
// peut de toute façon tout lire ; ce chemin n'élargit rien, il rend
// seulement la lecture exhaustive et reproductible.
//
// DEUX fonctions, et c'est le fond du problème plutôt qu'un détail de
// découpage — voir `exportByVisitor`.
import { v } from "convex/values"
import { internalQuery } from "./_generated/server"
import type { Doc } from "./_generated/dataModel"

/**
 * Ce que l'export NE couvre PAS, écrit dans le dossier lui-même.
 *
 * Une personne qui reçoit un export doit pouvoir distinguer « nous ne
 * détenons rien » de « nous n'avons pas regardé là ». Une enveloppe muette
 * sur ses angles morts se lit comme la première, alors qu'elle est la
 * seconde.
 */
const LIMITES_CONNUES = [
  "Les enregistrements de consentement ne sont PAS inclus : un consentRecord porte un `visitorId` tiré au hasard sur l'appareil, jamais une adresse électronique. Aucune jointure ne les relie à une personne identifiée par son email. Si la personne peut fournir son `visitorId` (cookie du bandeau), utiliser `dataSubject:exportByVisitor`.",
  "La mesure d'audience (Umami) vit dans une base PostgreSQL séparée, hors de Convex : cet export ne la voit pas. Elle ne conserve ni cookie ni adresse IP, et ne porte donc aucun identifiant permettant de retrouver une personne — mais l'affirmer relève de la configuration d'Umami, pas de ce code.",
  "Le compte d'administration lui-même (nom, email, mots de passe hachés, sessions) vit dans le composant Better Auth, qui a son propre schéma et n'est pas lu ici.",
]

export type LeadDossier = {
  lead: Doc<"leads">
  messages: Doc<"leadMessages">[]
  events: Doc<"leadEvents">[]
}

/**
 * Tout ce que le site détient sur une personne identifiée par son adresse.
 *
 * L'adresse est normalisée exactement comme `leads.submit` la normalise à
 * l'écriture (`trim().toLowerCase()`). Sans ce geste, une demande écrite
 * avec une majuscule recevrait « nous ne détenons rien à votre sujet » —
 * la pire réponse possible, parce qu'elle a l'air d'une réponse.
 *
 * `.collect()` sur l'index `by_email` plutôt que `.unique()` : l'unicité par
 * email est une invariante que `leads.submit` maintient, pas une contrainte
 * que la base impose. Un export qui lèverait une exception le jour où deux
 * lignes existent laisserait la demande sans réponse au moment précis où
 * elle est la plus justifiée.
 */
export const exportByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase()

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect()

    const dossiers: LeadDossier[] = []
    for (const lead of leads) {
      const [messages, events] = await Promise.all([
        ctx.db
          .query("leadMessages")
          .withIndex("by_lead", (q) => q.eq("leadId", lead._id))
          .collect(),
        ctx.db
          .query("leadEvents")
          .withIndex("by_lead", (q) => q.eq("leadId", lead._id))
          .collect(),
      ])
      dossiers.push({ lead, messages, events })
    }

    // Une invitation adressée à quelqu'un est une donnée sur cette
    // personne : son adresse, la date, le rôle qu'on lui proposait.
    // `tokenHash` et `pendingToken` sont retirés — ce ne sont pas ses
    // données mais des secrets d'authentification, et les remettre
    // transformerait une demande d'accès en moyen de se faire donner une
    // clé d'administration.
    const invitations = (
      await ctx.db
        .query("invitations")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect()
    ).map(({ tokenHash: _h, pendingToken: _p, ...rest }) => rest)

    return {
      subject: { email },
      generatedAt: Date.now(),
      leads: dossiers,
      invitations,
      notes: LIMITES_CONNUES,
    }
  },
})

/**
 * Les preuves de consentement d'un APPAREIL, jamais d'une personne.
 *
 * Fonction distincte parce que la donnée l'est. Un `consentRecord` porte un
 * `visitorId` tiré au hasard dans le navigateur au moment où le bandeau
 * s'affiche ; il ne croise aucune adresse électronique, aucun compte,
 * aucune fiche de contact — c'est même sa raison d'être : prouver un
 * consentement sans identifier qui l'a donné.
 *
 * Les rattacher à un email demanderait d'inventer une jointure qui
 * n'existe pas, et une jointure inventée ici rendrait le consentement de
 * QUELQU'UN D'AUTRE en réponse à une demande d'accès — une violation
 * commise en croyant répondre à un droit. La séparation en deux fonctions
 * est ce qui rend cette faute impossible à commettre par distraction.
 *
 * Le `visitorId` est dans le cookie du bandeau, côté visiteur. C'est donc
 * la personne qui le fournit, si elle le veut et si elle l'a encore.
 * Personne d'autre ne peut le retrouver — ce qui est une propriété, pas un
 * défaut.
 */
export const exportByVisitor = internalQuery({
  args: { visitorId: v.string() },
  handler: async (ctx, args) => {
    const consentRecords = await ctx.db
      .query("consentRecords")
      .withIndex("by_visitor", (q) => q.eq("visitorId", args.visitorId))
      // Du plus récent au plus ancien : « a accepté puis retiré » se lit
      // dans cet ordre.
      .order("desc")
      .collect()

    return {
      subject: { visitorId: args.visitorId },
      generatedAt: Date.now(),
      consentRecords,
      notes: [
        "Un `visitorId` désigne un NAVIGATEUR, pas une personne : le même visiteur sur un autre appareil a un autre identifiant, et un appareil partagé en a un seul pour plusieurs personnes.",
        "Les fiches de contact et les messages associés à une adresse électronique s'exportent séparément, avec `dataSubject:exportByEmail`.",
      ],
    }
  },
})

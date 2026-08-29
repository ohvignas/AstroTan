import { v } from "convex/values"
import type { MutationCtx } from "../_generated/server"

// ---------------------------------------------------------------------
// Le journal des gestes sensibles.
//
// Le dépôt savait déjà qui avait CRÉÉ une page (`createdBy`) et qui avait
// déplacé une fiche de contact (`leadEvents.actorName`). Il ne savait pas
// qui avait changé un rôle, écrit un jeton, supprimé un contact ou
// dépublié — et c'est le seul manque de cette liste qu'on ne peut pas
// reconstituer après coup, parce que la donnée n'existe nulle part.
//
// TROIS RÈGLES, chacune reprise de `leadEvents` qui les a déjà payées :
//
//   1. **La ligne s'écrit DANS la même mutation que le geste**, jamais par
//      une action planifiée. Une action planifiée peut échouer seule, et
//      un journal auquel il manque une ligne est pire qu'absent : on le
//      croit complet. Dans une mutation Convex, l'écriture et sa trace
//      valident ou échouent ensemble.
//   2. **Le nom de l'acteur est RECOPIÉ au moment du geste.** Le relire à
//      l'affichage rendrait anonymes toutes les lignes le jour où
//      quelqu'un quitte l'équipe — or c'est précisément ce jour-là qu'on
//      relit un journal.
//   3. **Aucune valeur de secret n'entre ici, même tronquée.** Un journal
//      se relit longtemps après, souvent par plus de monde que l'écran
//      d'origine. Le NOM du jeton suffit à raconter le geste ; sa valeur
//      n'ajoute rien qu'un risque. `auditLog.test.ts` l'atteste avec une
//      valeur sentinelle plutôt que de le promettre.
//
// Ce module ne fait référence à aucune table au-delà de `auditLog` et
// `profiles`, et n'importe rien d'exécutable hors de `convex/values` : il
// est importé par `schema.ts` (pour le validateur) autant que par les
// points d'écriture, et un import circulaire à l'exécution le casserait.
// ---------------------------------------------------------------------

/**
 * La liste close des gestes journalisés.
 *
 * Fermée volontairement : une union ouverte laisserait chaque appelant
 * inventer son propre libellé, et un journal dont les actions ne se
 * comptent pas ne se filtre pas non plus.
 */
export const AUDIT_ACTIONS = [
  "role.change",
  "user.remove",
  "secret.set",
  "secret.clear",
  "lead.remove",
  "page.publish",
  "page.unpublish",
  "settings.update",
  // Relecture finale, correctif 2 : ajout PUR — chaque valeur ci-dessous
  // est une nouvelle entrée dans cette union, jamais le retrait d'une
  // existante. `auditActionValidator` (plus bas) en dérive, et `schema.ts`
  // s'en sert pour la colonne `action` de `auditLog` : c'est exactement le
  // sens autorisé par l'invariant 6 de `CLAUDE.md` (expand, jamais
  // destructif) — une ligne déjà écrite avec une ancienne action reste
  // valide, rien ne change pour elle.
  //
  // `invitation.create` : un `admin` qui s'invite lui-même en `admin`
  // fabrique un second compte admin par un chemin que `users.setRole` ne
  // voit jamais — voir `invitations.ts:create`.
  "invitation.create",
  // `post.publish`/`post.unpublish` : même asymétrie que `page.publish`/
  // `page.unpublish` ci-dessus, côté articles — voir `posts.ts`.
  "post.publish",
  "post.unpublish",
  // `page.remove`/`post.remove` : supprimer est strictement plus
  // destructeur que dépublier (déjà journalisé), et ne l'était pas.
  "page.remove",
  "post.remove",
  // `emailTemplate.*` : l'écran d'envoi des emails décide ce que le site
  // écrit à des gens qui ne le liront jamais depuis l'administration — le
  // texte d'une invitation, ou le fait qu'une notification ne parte plus
  // du tout. Trois gestes distincts et non un seul : « a rétabli le texte
  // par défaut » et « a modifié le texte » ne se relisent pas de la même
  // façon six mois plus tard, et un journal qui les confond ne répond pas
  // à la question qu'on lui pose.
  //
  // Le CONTENU n'entre jamais dans la ligne, seulement le titre de
  // l'email visé : un gabarit peut porter la signature de l'entreprise ou
  // un lien interne, et `auditLog` n'est balayée par aucune purge de
  // `retention.ts`. `emails.test.ts` l'atteste plutôt que de le promettre.
  "emailTemplate.set",
  "emailTemplate.toggle",
  "emailTemplate.reset",
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** Le validateur du champ `action` de la table, dérivé de la liste unique. */
export const auditActionValidator = v.union(
  ...AUDIT_ACTIONS.map((action) => v.literal(action)),
)

/**
 * Le geste, en français, tel qu'un humain le relira.
 *
 * Pure et sans contexte : c'est ce qui la rend testable seule, et c'est
 * aussi ce qui permet de changer une formulation sans toucher à un seul
 * point d'écriture. Un journal qui afficherait `SET_ROLE` obligerait à
 * connaître le code pour le lire, et personne ne le consulte au moment où
 * il faudrait.
 *
 * `cible` et `detail` sont facultatifs parce que tous les gestes n'en ont
 * pas : `settings.update` ne vise rien en particulier. La phrase reste une
 * phrase sans eux — un `undefined` interpolé serait pire que l'absence.
 */
export function decrireAction(
  action: AuditAction,
  acteurNom: string,
  cible?: string,
  detail?: string,
): string {
  const quoi = cible ?? "un élément supprimé depuis"
  const suffixe = detail ? ` (${detail})` : ""
  switch (action) {
    case "role.change":
      return `${acteurNom} a changé le rôle de ${quoi}${detail ? ` en ${detail}` : ""}`
    case "user.remove":
      return `${acteurNom} a supprimé le compte de ${quoi}${suffixe}`
    case "secret.set":
      return `${acteurNom} a enregistré le jeton ${quoi}${suffixe}`
    case "secret.clear":
      return `${acteurNom} a retiré le jeton ${quoi}${suffixe}`
    case "lead.remove":
      return `${acteurNom} a supprimé la fiche de contact ${quoi}${suffixe}`
    case "page.publish":
      return `${acteurNom} a publié la page ${quoi}${suffixe}`
    case "page.unpublish":
      return `${acteurNom} a dépublié la page ${quoi}${suffixe}`
    case "settings.update":
      return `${acteurNom} a modifié les réglages du site${
        detail ? ` : ${detail}` : ""
      }`
    case "invitation.create":
      return `${acteurNom} a invité ${quoi}${detail ? ` en tant que ${detail}` : ""}`
    case "post.publish":
      return `${acteurNom} a publié l'article ${quoi}${suffixe}`
    case "post.unpublish":
      return `${acteurNom} a dépublié l'article ${quoi}${suffixe}`
    case "page.remove":
      return `${acteurNom} a supprimé la page ${quoi}${suffixe}`
    case "post.remove":
      return `${acteurNom} a supprimé l'article ${quoi}${suffixe}`
    case "emailTemplate.set":
      return `${acteurNom} a modifié le texte de l'email « ${quoi} »`
    // `detail` porte « désactivé » ou « réactivé », composé par
    // `emails.setActif` : le sens du geste tient dans ce mot, et le mettre
    // entre parenthèses en bout de phrase l'enterrerait.
    case "emailTemplate.toggle":
      return `${acteurNom} a ${detail ?? "modifié l'envoi de"} l'email « ${quoi} »`
    case "emailTemplate.reset":
      return `${acteurNom} a rétabli le texte par défaut de l'email « ${quoi} »`
  }
}

/**
 * Le nom sous lequel l'équipe se connaît, recopié dans la ligne.
 *
 * `profiles.displayName` plutôt que l'adresse : c'est ce que l'écran des
 * utilisateurs affiche déjà. L'email sert de repli — un profil peut
 * manquer le temps qu'`auth.onUpdate` le répare —, et il vaut toujours
 * mieux qu'une ligne sans auteur.
 *
 * Vivait dans `leads.ts`, où `leadEvents` l'utilise encore. Déplacée ici
 * plutôt que recopiée : deux façons de nommer le même acteur finiraient
 * par diverger, et l'écart ne se verrait que dans un historique qu'on
 * relit des mois plus tard.
 */
export async function nomDeLAuteur(
  ctx: MutationCtx,
  authUserId: string,
  email: string,
): Promise<string> {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", authUserId))
    .unique()
  return profile?.displayName ?? email
}

/**
 * Écrire la ligne de journal, dans la mutation qui vient de faire le geste.
 *
 * `acteur` est exactement ce que rend `requireRole` — `{_id, role, email}`
 * —, si bien qu'un point d'écriture n'a rien à aller chercher de plus :
 * il tient déjà l'acteur dans une variable, à deux lignes de son écriture.
 *
 * `cible` et `detail` sont des chaînes déjà composées par l'appelant, qui
 * est le seul à savoir ce qu'il est prudent d'y mettre. Deux décisions
 * prises à ce niveau-là, et documentées à chaque point d'écriture :
 *
 *   • aucune valeur de jeton, même tronquée ;
 *   • aucune donnée personnelle d'une personne qu'on vient précisément
 *     d'effacer (`leads.remove`) — l'inscrire ici défairait l'effacement
 *     que `/confidentialite` promet. (Correctif 4 : cette ligne citait
 *     `dataSubject.ts`, qui n'efface rien — il n'exporte que
 *     `exportByEmail`/`exportByVisitor`, en lecture seule. L'effacement
 *     lui-même vit dans `leads.remove`, la mutation qui écrit cette
 *     ligne de journal.)
 */
export async function journaliser(
  ctx: MutationCtx,
  entree: {
    acteur: { _id: string; email: string }
    action: AuditAction
    cible?: string
    detail?: string
  },
): Promise<void> {
  await ctx.db.insert("auditLog", {
    action: entree.action,
    acteurId: entree.acteur._id,
    acteurNom: await nomDeLAuteur(ctx, entree.acteur._id, entree.acteur.email),
    cible: entree.cible,
    detail: entree.detail,
  })
}

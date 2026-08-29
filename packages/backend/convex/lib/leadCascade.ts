import type { Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"

/**
 * Ce qui part avec une fiche de contact — la fiche, ses messages, son
 * historique — et rien d'autre.
 *
 * Extrait ici parce qu'il y a désormais DEUX chemins de suppression : le
 * geste d'un administrateur (`leads.remove`) et la purge automatique des
 * fiches sans échange depuis trois ans (`retention.purge`). Deux cascades
 * écrites séparément divergent — l'une gagne une table que l'autre oublie
 * le jour où une table s'ajoute, et l'oubli ne se voit pas : les lignes
 * orphelines ne s'affichent plus nulle part, elles restent seulement.
 *
 * `leads.remove` porte encore sa propre copie de cette logique, mot pour
 * mot ; elle doit être remplacée par un appel à cette fonction. Ce n'était
 * pas faisable dans le même passage (`leads.ts` était édité ailleurs au
 * même moment), et c'est exactement la situation que cette fonction existe
 * pour clore.
 *
 * NON BORNÉE, volontairement, et c'est la limite à connaître : une fiche
 * qui aurait reçu des dizaines de milliers de messages ferait dépasser la
 * limite de lecture d'une transaction Convex. L'appelant borne le nombre de
 * FICHES par passage (`RETENTION_BATCH_SIZE`), pas le nombre de messages
 * d'une fiche ; avec un plafond de 5 000 caractères par message et un
 * formulaire public, le cas ne se présente pas à l'échelle d'un site
 * vitrine. Le jour où il se présenterait, c'est ici que la pagination
 * viendrait.
 */
export async function deleteLeadCascade(
  ctx: MutationCtx,
  leadId: Id<"leads">,
): Promise<{ messages: number; events: number }> {
  // Les messages partent avec la fiche. Les laisser derrière serait une
  // fuite silencieuse : plus personne ne les verrait, et ils resteraient.
  const messages = await ctx.db
    .query("leadMessages")
    .withIndex("by_lead", (q) => q.eq("leadId", leadId))
    .collect()
  for (const message of messages) await ctx.db.delete(message._id)

  // L'historique part avec, pour la même raison : des événements qui
  // désignent une fiche disparue ne se rendent nulle part et ne se
  // suppriment plus.
  const events = await ctx.db
    .query("leadEvents")
    .withIndex("by_lead", (q) => q.eq("leadId", leadId))
    .collect()
  for (const event of events) await ctx.db.delete(event._id)

  await ctx.db.delete(leadId)
  return { messages: messages.length, events: events.length }
}

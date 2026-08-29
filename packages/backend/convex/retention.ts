// Les durées de conservation, et le seul endroit du dépôt qui les applique.
//
// Un audit RGPD relève toujours le même écart en premier, parce qu'il se
// vérifie en une requête : une durée ANNONCÉE sur `/confidentialite` que
// rien n'exécute. « 3 ans après le dernier échange » écrit en face d'une
// table que personne ne balaie n'est pas une politique, c'est une
// déclaration fausse — et la fausse déclaration est précisément ce que le
// règlement sanctionne (articles 5-1-e et 13-2-a).
//
// Ce module existe pour que la phrase publiée et le comportement réel
// soient la même chose. Les deux constantes ci-dessous sont la source
// unique : la page `/confidentialite` doit les LIRE, pas les recopier.
//
// Se lance seul (cron mensuel, `crons.ts`), et à la main quand un opérateur
// veut vider un retard tout de suite :
//
//     npx convex run retention:purge
//
// `internalMutation`, jamais `mutation` : rien de ce que fait ce module ne
// doit être atteignable depuis un client. Une suppression en masse
// déclenchable par un navigateur serait la meilleure façon de perdre trois
// ans de contacts sur une requête forgée.
import { internalMutation } from "./_generated/server"
import { internal } from "./_generated/api"
import { LEAD_STATUSES } from "./content"
import { deleteLeadCascade } from "./lib/leadCascade"

const JOUR_MS = 24 * 60 * 60 * 1000

/**
 * Les fiches de contact : 3 ans après le dernier échange.
 *
 * C'est la durée annoncée par la ligne « Répondre à un message envoyé par
 * le formulaire de contact » du registre (`apps/web/src/config/legal.ts`),
 * et elle vient de la recommandation constante de la CNIL sur la
 * prospection et la relation commerciale : trois ans à compter du dernier
 * contact ÉMANANT DE LA PERSONNE — d'où `lastMessageAt`, et non
 * `_creationTime`, qui daterait sa première venue.
 *
 * 3 × 365 jours, pas trois années calendaires : environ un jour de moins,
 * du fait des bissextiles. L'écart est du bon côté — supprimer un jour trop
 * tôt tient la promesse publiée, un jour trop tard la rompt.
 */
export const LEAD_RETENTION_DAYS = 3 * 365
export const LEAD_RETENTION_MS = LEAD_RETENTION_DAYS * JOUR_MS

/**
 * Les preuves de consentement : la durée de validité d'un consentement.
 *
 * 365 jours, la valeur d'`expirationDays` dans
 * `apps/web/src/config/consent.ts` — ces deux nombres DOIVENT rester égaux,
 * et c'est le seul couplage que ce module ne peut pas vérifier lui-même :
 * `packages/backend/` ne dépend pas d'`apps/web/`, et l'inverse est la
 * bonne direction (la page lit le backend, jamais le contraire).
 *
 * Passé ce délai, le bandeau redemande son avis à la personne : la preuve
 * ancienne ne soutient plus aucun traitement, et la garder ne fait plus que
 * conserver un identifiant d'appareil et un horodatage pour rien — ce qui
 * est exactement le traitement que l'article 5-1-e interdit de prolonger
 * sans finalité. Un site qui raccourcit `expirationDays` (la CNIL
 * recommande six mois) doit raccourcir cette constante d'autant.
 *
 * Lecture plus stricte, à connaître : certains conseillent de conserver la
 * preuve aussi longtemps que la responsabilité peut être engagée sur le
 * traitement qu'elle autorisait, donc plus longtemps que sa validité. Ce
 * dépôt tranche pour la durée de validité, parce que c'est celle que la
 * page publiée annonce. Changer d'avis, c'est changer ce nombre ET la page.
 */
export const CONSENT_RETENTION_DAYS = 365
export const CONSENT_RETENTION_MS = CONSENT_RETENTION_DAYS * JOUR_MS

/**
 * Combien de lignes au plus par passage, et par table.
 *
 * Une purge qui ferait `.collect()` sur une table entière marcherait
 * parfaitement jusqu'au jour où la table est grande — puis dépasserait la
 * limite de lecture d'une transaction Convex et échouerait à chaque
 * passage, sans que rien ne le signale. C'est la panne qui arrive au
 * moment où la purge est le plus nécessaire.
 *
 * Le passage lit donc un lot borné, par index, et s'arrête. Si le lot est
 * plein, il en reste : `purge` se replanifie alors immédiatement plutôt que
 * d'attendre le mois suivant — sans quoi un retard de dix mille lignes
 * mettrait cent mois à se résorber, et la durée annoncée resterait fausse
 * pendant tout ce temps. La reprise ne peut pas boucler : elle n'a lieu que
 * si le passage a effectivement supprimé un lot PLEIN, donc que si le
 * nombre de lignes à supprimer a strictement diminué.
 */
export const RETENTION_BATCH_SIZE = 100

export type PurgeReport = {
  leads: number
  leadMessages: number
  leadEvents: number
  consentRecords: number
  /** Un lot était plein : une reprise a été planifiée. */
  hasMore: boolean
}

export const purge = internalMutation({
  args: {},
  handler: async (ctx): Promise<PurgeReport> => {
    const now = Date.now()

    // --- Les fiches de contact ------------------------------------------
    //
    // Pas d'index sur `lastMessageAt` seul, et il n'en faut pas : le couple
    // `by_status` = ["status", "lastMessageAt"] existe déjà pour les
    // colonnes du tableau, et une borne `lt` sur son second champ est une
    // vraie plage d'index dès lors que le premier est fixé. On la parcourt
    // donc une fois par colonne — la liste est fermée (`LEAD_STATUSES`), et
    // la dériver plutôt que de l'écrire ici est ce qui fait qu'une colonne
    // ajoutée demain sera balayée sans que personne y pense. Ajouter un
    // index de plus au schéma aurait donné la même chose au prix d'une
    // migration.
    const leadCutoff = now - LEAD_RETENTION_MS
    let budget = RETENTION_BATCH_SIZE
    const stale = []
    for (const status of LEAD_STATUSES) {
      if (budget <= 0) break
      const rows = await ctx.db
        .query("leads")
        .withIndex("by_status", (q) =>
          q.eq("status", status).lt("lastMessageAt", leadCutoff),
        )
        // Ordre croissant sur `lastMessageAt` : les plus anciennes d'abord,
        // ce qui est l'ordre dans lequel on veut résorber un retard.
        .take(budget)
      stale.push(...rows)
      budget -= rows.length
    }

    let leadMessages = 0
    let leadEvents = 0
    for (const lead of stale) {
      // La MÊME cascade que le geste manuel d'un administrateur. Deux
      // cascades écrites séparément divergent — voir `lib/leadCascade.ts`.
      const removed = await deleteLeadCascade(ctx, lead._id)
      leadMessages += removed.messages
      leadEvents += removed.events
    }

    // --- Les preuves de consentement -------------------------------------
    //
    // Sur `_creationTime`, l'index système de toute table Convex — donc
    // aucune modification de schéma, et rien à migrer. C'est aussi le bon
    // champ : `timestamp` est l'heure de l'APPAREIL, recopiée telle quelle
    // depuis le navigateur, avec son fuseau ; deux lignes écrites à la même
    // seconde peuvent y porter des heures distantes de treize heures, et
    // une durée de conservation calculée sur une horloge que le visiteur
    // contrôle ne conserve rien de fiable. `_creationTime` est notre heure,
    // celle de l'écriture.
    const consentCutoff = now - CONSENT_RETENTION_MS
    const staleConsents = await ctx.db
      .query("consentRecords")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", consentCutoff))
      .take(RETENTION_BATCH_SIZE)
    for (const row of staleConsents) await ctx.db.delete(row._id)

    const hasMore =
      stale.length >= RETENTION_BATCH_SIZE ||
      staleConsents.length >= RETENTION_BATCH_SIZE

    // La reprise. `runAfter(0)` et non un second appel direct : chaque
    // passage reste une transaction courte et bornée, et une transaction
    // qui échoue ne perd que son propre lot.
    if (hasMore) await ctx.scheduler.runAfter(0, internal.retention.purge, {})

    return {
      leads: stale.length,
      leadMessages,
      leadEvents,
      consentRecords: staleConsents.length,
      hasMore,
    }
  },
})

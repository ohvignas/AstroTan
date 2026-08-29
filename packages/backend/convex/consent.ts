// La preuve du consentement.
//
// Le RGPD (article 7-1) demande de pouvoir DÉMONTRER qu'une personne a
// consenti — pas seulement d'avoir affiché un bandeau. Cette table est cette
// démonstration : une ligne par geste, avec ce qui a été accordé, quand, et
// sur quelle version de la politique.
//
// Elle est éteinte par défaut (`traceability.enabled` dans
// `apps/web/src/config/consent.ts`), et c'est un arbitrage assumé plutôt
// qu'une négligence : conserver la preuve, c'est conserver un identifiant
// d'appareil et un horodatage pour chaque visiteur qui répond — donc
// traiter une donnée personnelle de plus, au nom de la conformité. Un site
// vitrine sans publicité ciblée s'en passe ; un site qui fait de la
// publicité ciblée a tout intérêt à l'allumer.
//
// Comme `leads.submit`, l'écriture passe par une porte étroite : le
// navigateur ne parle jamais ici. Il poste sur `/api/consent`, qui détient
// le secret partagé et l'ajoute côté serveur.
import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { api } from "./_generated/api"
import { MUTATION_REGISTRY } from "./_registry"
import { requireRole } from "./lib/authz"
import { consentActionValidator } from "./validators"
import { timingSafeEqualHex } from "./lib/previewToken"



/** Bornes de longueur : ces valeurs viennent d'un client, jamais de nous. */
const MAX_ID_LENGTH = 64
const MAX_VERSION_LENGTH = 32
const MAX_TIMESTAMP_LENGTH = 32

export const record = mutation({
  args: {
    secret: v.string(),
    consentVersion: v.string(),
    visitorId: v.string(),
    consentId: v.string(),
    action: consentActionValidator,
    timestamp: v.string(),
    analytics: v.boolean(),
    marketing: v.boolean(),
    preferences: v.boolean(),
  },
  handler: async (ctx, args) => {
    const expected = process.env.CONSENT_LOG_SECRET
    // Un déploiement sans secret refuse, jamais ne laisse passer : l'oubli
    // de configuration est le cas fréquent, et c'est celui où une porte
    // ouverte ne se voit pas.
    if (!expected) throw new Error("CONSENT_LOG_SECRET is not set")
    if (!timingSafeEqualHex(args.secret, expected)) {
      throw new Error("Secret invalide")
    }

    if (
      args.visitorId.length > MAX_ID_LENGTH ||
      args.consentId.length > MAX_ID_LENGTH ||
      args.consentVersion.length > MAX_VERSION_LENGTH ||
      args.timestamp.length > MAX_TIMESTAMP_LENGTH
    ) {
      throw new Error("Champ trop long")
    }

    // Idempotent par `consentId`. La requête part avec `keepalive` au moment
    // où quelqu'un quitte la page ; un navigateur peut la rejouer, et deux
    // lignes pour un seul clic feraient mentir le journal sur ce qui s'est
    // passé.
    const existing = await ctx.db
      .query("consentRecords")
      .withIndex("by_consent", (q) => q.eq("consentId", args.consentId))
      .first()
    if (existing !== null) return existing._id

    const { secret: _ignore, ...row } = args
    return ctx.db.insert("consentRecords", row)
  },
})

/**
 * L'historique d'un appareil — ce qu'on produit quand quelqu'un demande à
 * voir sa preuve, ou quand une autorité la demande.
 *
 * Il n'y a pas encore d'écran pour cela dans l'administration : la lecture
 * se fait par `npx convex run consent:history '{"visitorId":"…"}'`. Le dire
 * franchement vaut mieux que de laisser croire à un tableau de bord qui
 * n'existe pas.
 */
export const history = query({
  args: { visitorId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])
    return ctx.db
      .query("consentRecords")
      .withIndex("by_visitor", (q) => q.eq("visitorId", args.visitorId))
      .order("desc")
      .collect()
  },
})

MUTATION_REGISTRY.push({
  name: "consent.record",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: (t) =>
    t.mutation(api.consent.record, {
      secret: process.env.CONSENT_LOG_SECRET ?? "",
      consentVersion: "1.0.0",
      visitorId: `registry-${Date.now()}-${Math.random()}`,
      consentId: `registry-${Date.now()}-${Math.random()}`,
      action: "custom",
      timestamp: new Date().toISOString(),
      analytics: true,
      marketing: false,
      preferences: false,
    }),
})

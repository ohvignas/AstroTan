import { query } from "./_generated/server"
import { requireRole } from "./lib/authz"
import { decrireAction, type AuditAction } from "./lib/auditEvent"

// La lecture du journal. L'écriture, elle, ne passe jamais par ici : elle
// se fait dans la mutation qui accomplit le geste, par `journaliser`
// (`lib/auditEvent.ts`) — voir l'en-tête de ce module pour pourquoi une
// action planifiée aurait été le mauvais choix.

export type AuditLine = {
  _id: string
  at: number
  action: AuditAction
  acteurNom: string
  cible: string | null
  detail: string | null
  /** Le geste en français, calculé à la lecture. */
  phrase: string
}

/**
 * Les derniers gestes sensibles, du plus récent au plus ancien.
 *
 * `owner`/`admin` seulement : le journal dit qui a changé quoi, y compris
 * des rôles et des jetons, et un editor y figure sans avoir à le lire.
 *
 * Aucun index n'est nécessaire — l'ordre chronologique est celui de
 * l'index implicite `by_creation_time` que Convex tient sur toute table.
 *
 * La PHRASE est calculée ici et non stockée : changer une formulation ne
 * doit pas demander de réécrire l'histoire, et deux copies d'une même
 * phrase — celle en base et celle du code — finiraient par diverger.
 *
 * Borné à 200 lignes, sans argument de pagination : un journal se consulte
 * par sa tête. Le jour où l'écran voudra remonter plus loin, il faudra un
 * curseur, pas une limite plus grande.
 */
const MAX_LIGNES = 200

export const list = query({
  args: {},
  handler: async (ctx): Promise<AuditLine[]> => {
    await requireRole(ctx, ["owner", "admin"])
    const rows = await ctx.db.query("auditLog").order("desc").take(MAX_LIGNES)
    return rows.map((row) => ({
      _id: row._id,
      at: row._creationTime,
      action: row.action,
      acteurNom: row.acteurNom,
      cible: row.cible ?? null,
      detail: row.detail ?? null,
      phrase: decrireAction(row.action, row.acteurNom, row.cible, row.detail),
    }))
  },
})

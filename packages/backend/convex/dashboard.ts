import type { GenericDocument, PaginationResult } from "convex/server"
import { query, type QueryCtx } from "./_generated/server"
import { components } from "./_generated/api"
import { requireRole } from "./lib/authz"
import { LEAD_STATUSES, type LeadStatus } from "./content"

// L'accueil de l'administration, en un seul appel.
//
// Une `query` et non une `action`, et c'est le point de conception : le
// tableau de bord est abonné, donc un lead qui arrive fait bouger son
// compte à la seconde, sans rechargement. Une `action` rendrait des
// chiffres figés au moment du rendu — un tableau de bord qui ment
// tranquillement jusqu'à ce que quelqu'un pense à rafraîchir.
//
// Elle ne parle à aucun service extérieur : tout ce qu'elle compte est
// dans cette base. Les chiffres d'audience, eux, viennent d'Umami et
// restent dans `analytics.siteSummary`, qui est une `action` parce qu'elle
// sort sur le réseau. Les deux se posent côte à côte à l'écran ; les
// mélanger dans une seule fonction aurait fait dépendre la réactivité des
// premiers de la disponibilité du second.

/**
 * Un compte, et l'aveu qu'il puisse être tronqué.
 *
 * Convex n'a pas de `count()` : compter, c'est lire. Les tables qui
 * grossissent sans borne (médias, leads, articles) sont donc lues jusqu'à
 * un plafond, et au-delà le nombre rendu est un MINIMUM — `capped` est ce
 * qui permet à l'interface d'écrire « 1 000+ » au lieu d'un « 1 000 » faux.
 * Sans ce drapeau, la troncature serait invisible : un chiffre plafonné a
 * exactement l'air d'un chiffre exact.
 */
export interface Tally {
  count: number
  capped: boolean
}

/**
 * Ce qu'une lecture de comptage s'autorise à parcourir.
 *
 * 1 000 documents par compteur, huit compteurs : très en dessous de la
 * limite de lecture d'une query Convex (16 384 documents), et sans commune
 * mesure avec le temps de rendu de l'écran. Ce qui casserait ce choix :
 * une médiathèque ou une file de leads au-delà de 1 000 lignes — le compte
 * se fige alors à 1 000 et se déclare tronqué, ce qui est le
 * comportement voulu, mais l'écran perd la vraie valeur. Le jour où ce
 * plafond devient gênant, la réponse n'est pas de l'augmenter (la limite
 * de lecture arriverait) mais de tenir des compteurs incrémentaux, écrits
 * dans les mêmes mutations que les lignes qu'ils comptent.
 */
export const COUNT_CAP = 1_000

/** Le contrat minimal d'une requête Convex, pour que `tally` soit testable seul. */
interface Takeable {
  take(n: number): Promise<unknown[]>
}

/**
 * Compte en lisant un document de plus que le plafond.
 *
 * `take(CAP + 1)` et non `take(CAP)` : lire exactement le plafond rend
 * « pile 1 000 » et « au moins 1 000 » indiscernables. Le document
 * supplémentaire est le seul moyen de distinguer les deux, et il n'est
 * jamais compté.
 */
export async function tally(q: Takeable): Promise<Tally> {
  const rows = await q.take(COUNT_CAP + 1)
  return { count: Math.min(rows.length, COUNT_CAP), capped: rows.length > COUNT_CAP }
}

export interface DashboardOverview {
  pages: { published: Tally; draft: Tally }
  posts: { published: Tally; draft: Tally; lastPublishedAt: number | null }
  leads: { byStatus: Record<LeadStatus, Tally>; total: Tally }
  media: { files: Tally; bytes: number }
  /** `null` pour un éditeur — les comptes ne sont pas de son ressort. */
  users: { total: Tally; pendingInvitations: Tally } | null
  /** `null` pour un éditeur, comme `redirects.list` le lui refuse déjà. */
  redirects: { enabled: Tally; total: Tally } | null
}

const LIST_PAGE_SIZE = 200

/**
 * Combien de comptes existent, en paginant l'adaptateur Better Auth.
 *
 * Le rôle vit sur l'utilisateur Better Auth (invariant 4), donc la table
 * `user` est dans un composant et n'est pas interrogeable par `ctx.db` :
 * la seule voie est `adapter.findMany`, paginé, comme `users.list` le fait
 * déjà. Plafonné de la même façon que le reste — une équipe au-delà de
 * mille comptes n'est pas ce que ce template dessert.
 */
async function countAuthUsers(ctx: QueryCtx): Promise<Tally> {
  let cursor: string | null = null
  let count = 0
  for (;;) {
    const page: PaginationResult<GenericDocument> = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: "user" as const,
        paginationOpts: { numItems: LIST_PAGE_SIZE, cursor },
      },
    )
    count += page.page.length
    if (count > COUNT_CAP) return { count: COUNT_CAP, capped: true }
    if (page.isDone) return { count, capped: false }
    cursor = page.continueCursor
  }
}

export const overview = query({
  args: {},
  handler: async (ctx): Promise<DashboardOverview> => {
    // Le rôle est revérifié ici comme partout ailleurs : l'interface
    // masque, elle ne décide pas.
    const actor = await requireRole(ctx, ["owner", "admin", "editor"])
    const gestionnaire = actor.role === "owner" || actor.role === "admin"

    // Chaque compte passe par un index : `.eq("status", …)` est un parcours
    // de plage, jamais une lecture de la table entière filtrée en mémoire.
    const pages = {
      published: await tally(
        ctx.db.query("pages").withIndex("by_status", (q) => q.eq("status", "published")),
      ),
      draft: await tally(
        ctx.db.query("pages").withIndex("by_status", (q) => q.eq("status", "draft")),
      ),
    }

    // `by_status_published` est composé `["status", "publishedAt"]` : la
    // même plage d'index sert à compter et, prise à l'envers, à trouver le
    // dernier publié en UN document. Un `.collect()` suivi d'un `Math.max`
    // aurait lu tout le blog pour en tirer un seul nombre.
    const dernierPublie = await ctx.db
      .query("posts")
      .withIndex("by_status_published", (q) => q.eq("status", "published"))
      .order("desc")
      .first()

    const posts = {
      published: await tally(
        ctx.db
          .query("posts")
          .withIndex("by_status_published", (q) => q.eq("status", "published")),
      ),
      draft: await tally(
        ctx.db.query("posts").withIndex("by_status_published", (q) => q.eq("status", "draft")),
      ),
      // `?? null` et jamais `?? 0` : zéro est une date valide (1970), et
      // un blog sans publication afficherait « il y a cinquante-six ans ».
      lastPublishedAt: dernierPublie?.publishedAt ?? null,
    }

    // Dérivé de `LEAD_STATUSES`, pas d'une liste recopiée : une sixième
    // colonne au tableau des leads apparaît ici sans qu'on y pense, et
    // une colonne vide vaut zéro plutôt que d'être absente — dans un
    // tableau de bord, « absent » et « zéro » se ressemblent et ne disent
    // pas la même chose.
    const byStatus = {} as Record<LeadStatus, Tally>
    for (const status of LEAD_STATUSES) {
      byStatus[status] = await tally(
        ctx.db.query("leads").withIndex("by_status", (q) => q.eq("status", status)),
      )
    }
    const leads = {
      byStatus,
      total: {
        count: LEAD_STATUSES.reduce((n, s) => n + byStatus[s].count, 0),
        capped: LEAD_STATUSES.some((s) => byStatus[s].capped),
      },
    }

    // Le SEUL parcours sans index de cette query, et il est inévitable :
    // le poids total est une somme sur chaque ligne, donc il faut les
    // lire. `media` n'a d'index que `by_storage` et `by_created_by`, dont
    // aucun ne restreint quoi que ce soit ici. Borné par `COUNT_CAP` comme
    // le reste ; au-delà, `files.capped` est vrai et `bytes` est un
    // minimum — l'interface doit alors écrire « au moins ».
    const mediaRows = await ctx.db.query("media").take(COUNT_CAP + 1)
    const media = {
      files: {
        count: Math.min(mediaRows.length, COUNT_CAP),
        capped: mediaRows.length > COUNT_CAP,
      },
      bytes: mediaRows.slice(0, COUNT_CAP).reduce((n, row) => n + row.size, 0),
    }

    if (!gestionnaire) {
      return { pages, posts, leads, media, users: null, redirects: null }
    }

    // Une invitation « en attente » est une invitation ACTIONNABLE : ni
    // acceptée, ni périmée. Compter les périmées ferait attendre quelqu'un
    // qui ne viendra jamais. La table n'a pas d'index là-dessus (elle est
    // indexée par jeton et par email), mais elle est bornée par nature :
    // une ligne par invitation en cours, supprimée à la révocation.
    const now = Date.now()
    const invitations = await ctx.db.query("invitations").take(COUNT_CAP + 1)
    const enAttente = invitations
      .slice(0, COUNT_CAP)
      .filter((row) => row.acceptedAt === undefined && row.expiresAt > now)

    const redirections = await ctx.db.query("redirects").take(COUNT_CAP + 1)

    return {
      pages,
      posts,
      leads,
      media,
      users: {
        total: await countAuthUsers(ctx),
        pendingInvitations: {
          count: enAttente.length,
          capped: invitations.length > COUNT_CAP,
        },
      },
      redirects: {
        // Une redirection éteinte existe encore et ne redirige rien : les
        // additionner ferait croire que deux chemins sont couverts.
        enabled: {
          count: redirections.slice(0, COUNT_CAP).filter((r) => r.enabled).length,
          capped: redirections.length > COUNT_CAP,
        },
        total: {
          count: Math.min(redirections.length, COUNT_CAP),
          capped: redirections.length > COUNT_CAP,
        },
      },
    }
  },
})

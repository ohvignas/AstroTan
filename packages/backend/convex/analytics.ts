import { v } from "convex/values"
import { action, query } from "./_generated/server"
import type { ActionCtx } from "./_generated/server"
import { api } from "./_generated/api"
import { MUTATION_REGISTRY } from "./_registry"
import { lireSecret } from "./secrets"
import { requireRole } from "./lib/authz"
import {
  clearUmamiToken,
  getUmamiToken,
  readUmamiConfig,
  type UmamiConfig,
} from "./lib/umamiToken"

// Per-page statistics, read from a self-hosted Umami.
//
// An `action` and not a `query`, because it makes an outbound HTTP call and
// Convex queries cannot. The distinction matters beyond the type signature:
// a query is reactive and would re-run on every subscription tick, calling
// an external service the dashboard does not own once per render.
//
// The credentials live in this deployment's environment and never leave it.
// `PUBLIC_UMAMI_URL` and `PUBLIC_UMAMI_WEBSITE_ID` are public by design —
// they appear in the page source of every tracked site — but the username
// and password that *read* statistics are not, and the browser never sees
// them. That asymmetry is the whole reason this lives in Convex rather than
// being fetched from the admin app.

interface Stats {
  pageviews: number
  visitors: number
  pageviewsPrev: number | null
  visitorsPrev: number | null
}

export interface AnalyticsResult {
  /** `null` whenever `status` is not `"ok"`. */
  last7: Stats | null
  last30: Stats | null
  /**
   * Why there are no numbers, when there are none. The dashboard renders
   * this instead of failing: a screen that breaks because a third-party
   * service is down is worse than a screen with no numbers on it.
   */
  status: "ok" | "not-configured" | "unreachable" | "unauthorized"
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * La réponse de `/stats`, telle qu'Umami 3 la rend réellement.
 *
 * `comparison` porte les valeurs ABSOLUES de la période précédente, pas un
 * écart. Il est rempli que la requête porte `compare=prev` ou non — vérifié
 * sur 3.3.1, fenêtre courante à 4 vues et précédente à 15, identique dans
 * les deux cas.
 */
interface RawStats {
  pageviews?: number
  visitors?: number
  comparison?: { pageviews?: number; visitors?: number }
}

async function fetchStats(
  cfg: UmamiConfig,
  token: string,
  path: string,
  sinceMs: number,
  now: number
): Promise<{ stats: Stats | null; unauthorized: boolean }> {
  const params = new URLSearchParams({
    startAt: String(now - sinceMs),
    endAt: String(now),
    // `path`, and NOT `url`. Umami 3 dropped `url` without removing it:
    // passing it is accepted and silently IGNORED, and the endpoint answers
    // with the whole site's totals. Verified against 3.3.1 — `url=/contact`
    // returned 11 pageviews where `path=/contact` returned 2. A per-page
    // panel showing the entire site's figures would have looked perfectly
    // plausible and been wrong on every page.
    path,
    compare: "prev",
  })

  const response = await fetch(
    `${cfg.url}/api/websites/${cfg.websiteId}/stats?${params}`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
  )
  if (response.status === 401) return { stats: null, unauthorized: true }
  if (!response.ok) return { stats: null, unauthorized: false }

  // Umami 3 returns flat numbers — `{"pageviews": 11, "visitors": 1, …}` —
  // not the `{value, prev}` objects of version 2. Read as v2, every figure
  // came out `undefined` and defaulted to zero: a page that looked
  // permanently unvisited.
  const body = (await response.json()) as RawStats
  return {
    stats: {
      pageviews: body.pageviews ?? 0,
      visitors: body.visitors ?? 0,
      pageviewsPrev:
        body.comparison?.pageviews === undefined ? null : body.comparison.pageviews,
      visitorsPrev:
        body.comparison?.visitors === undefined ? null : body.comparison.visitors,
    },
    unauthorized: false,
  }
}

/**
 * La configuration Umami, environnement d'abord, base ensuite.
 *
 * `readUmamiConfig(process.env)` ne voyait que l'environnement : un
 * identifiant saisi dans l'administration était chiffré, rangé, et ignoré.
 * Un réglage décoratif est pire qu'un réglage absent — on croit avoir agi.
 *
 * `lireSecret` porte la précédence à un seul endroit : si la variable
 * d'environnement existe, elle gagne, et le comportement est identique à
 * celui d'avant pour tout déploiement déjà configuré.
 */
async function resoudreUmamiConfig(ctx: ActionCtx) {
  const [url, websiteId, username, password] = await Promise.all([
    lireSecret(ctx, "UMAMI_API_URL"),
    lireSecret(ctx, "UMAMI_API_WEBSITE_ID"),
    lireSecret(ctx, "UMAMI_API_USERNAME"),
    lireSecret(ctx, "UMAMI_API_PASSWORD"),
  ])
  return readUmamiConfig({
    UMAMI_API_URL: url ?? undefined,
    UMAMI_API_WEBSITE_ID: websiteId ?? undefined,
    UMAMI_API_USERNAME: username ?? undefined,
    UMAMI_API_PASSWORD: password ?? undefined,
  })
}

export const forPath = action({
  args: { path: v.string() },
  handler: async (ctx, args): Promise<AnalyticsResult> => {
    // Statistics are readable by anyone who can edit what they measure —
    // and by nobody else. The role is re-checked here, as in every other
    // Convex function: the UI hides, it does not decide.
    await requireRole(ctx, ["owner", "admin", "editor"])

    const cfg = await resoudreUmamiConfig(ctx)
    // Not configured is an ordinary answer, not a failure: a template that
    // ships without analytics must not look broken to whoever adopts it.
    if (cfg === null) {
      return { last7: null, last30: null, status: "not-configured" }
    }

    const now = Date.now()

    try {
      let token = await getUmamiToken(cfg, now)
      if (token === null) {
        return { last7: null, last30: null, status: "unauthorized" }
      }

      let seven = await fetchStats(cfg, token, args.path, 7 * DAY_MS, now)
      if (seven.unauthorized) {
        // The cached token outlived its server-side session. Exactly one
        // retry after a fresh login: a loop here would replay the
        // credentials on every dashboard render.
        clearUmamiToken()
        token = await getUmamiToken(cfg, now)
        if (token === null) {
          return { last7: null, last30: null, status: "unauthorized" }
        }
        seven = await fetchStats(cfg, token, args.path, 7 * DAY_MS, now)
      }
      if (seven.stats === null) {
        return { last7: null, last30: null, status: "unreachable" }
      }

      const thirty = await fetchStats(cfg, token, args.path, 30 * DAY_MS, now)

      return {
        last7: seven.stats,
        // A 30-day window that fails while the 7-day one succeeded is not
        // worth failing the whole screen over: the shorter window is the
        // one being written against.
        last30: thirty.stats,
        status: "ok",
      }
    } catch {
      // A timeout, a DNS failure, a service that is down. The dashboard
      // reports "unreachable" and keeps working — statistics are
      // information, never a dependency of editing a page.
      return { last7: null, last30: null, status: "unreachable" }
    }
  },
})

// --- Le résumé du site, pour l'accueil de l'administration ----------------

export interface Metric {
  value: number
  /** Le même nombre sur la période précédente, tel qu'Umami le rend. */
  prev: number
}

export interface SeriesPoint {
  date: string
  visitors: number
  pageviews: number
}

export interface RankedItem {
  label: string
  /**
   * Des **visites**, pas des vues — et l'écart n'est pas cosmétique.
   *
   * `/metrics` compte une visite par session, quand `/stats?path=` compte
   * chaque affichage. Mesuré sur la même journée : `/` sortait à 2 par
   * `/metrics` et à 5 vues par `/stats`. Nommer ce champ `views` faisait
   * afficher un chiffre juste sous une étiquette fausse, et sous-estimait
   * de plus de la moitié.
   */
  visits: number
}

// --- La granularité demandée ---------------------------------------------

/**
 * Les trois fenêtres offertes, et rien d'autre.
 *
 * Ce sont des FENÊTRES, pas des unités Umami : deux d'entre elles se lisent
 * au pas du jour et ne se distinguent que par leur longueur. L'unité reste
 * un détail d'implémentation, et `GRANULARITES` est le seul endroit qui
 * traduit l'une en l'autre.
 *
 * `annee` vaut douze seaux MENSUELS, jamais un seau annuel : `unit: "year"`
 * avec `count: 1` rendrait un point unique, et la courbe refuse de tracer
 * sous deux points (`CourbeAudience`) — l'écran afficherait « pas encore
 * assez de mesures » sur une année pleine de trafic.
 *
 * Une liste fermée plutôt qu'une chaîne libre : « trimestre » a l'air
 * raisonnable et rend `400` chez Umami (`unit` n'admet que `minute` `hour`
 * `day` `month` `year`, vérifié contre 3.3.1). Une chaîne libre le
 * laisserait arriver jusqu'ici pour y devenir silencieusement le défaut —
 * un graphique au mauvais pas, sans un mot.
 */
export const PERIODES = ["semaine", "mois", "annee"] as const
export type Periode = (typeof PERIODES)[number]
export type Unit = "day" | "month" | "year"

const periodeValidator = v.union(
  ...(PERIODES.map((p) => v.literal(p)) as [
    ReturnType<typeof v.literal<"semaine">>,
    ReturnType<typeof v.literal<"mois">>,
    ReturnType<typeof v.literal<"annee">>,
  ]),
)

const GRANULARITES: Record<Periode, { unit: Unit; count: number }> = {
  semaine: { unit: "day", count: 7 },
  mois: { unit: "day", count: 30 },
  annee: { unit: "month", count: 12 },
}

export interface Fenetre {
  periode: Periode
  unit: Unit
  startAt: number
  endAt: number
  /**
   * Toutes les clés de seau attendues, du plus ancien au plus récent.
   *
   * Elles sont ENGENDRÉES ici, pas lues dans la réponse : `/pageviews`
   * omet les intervalles vides au lieu de les rendre à zéro (un mois avec
   * trois jours de trafic rend trois points), et un graphique tracé sur ce
   * qu'Umami a bien voulu rendre ment sur les dates.
   */
  buckets: string[]
}

/** Le début du seau contenant `ms`, en UTC. */
function bucketStart(ms: number, unit: Unit): number {
  const d = new Date(ms)
  if (unit === "year") return Date.UTC(d.getUTCFullYear(), 0, 1)
  if (unit === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Le début du seau situé `n` seaux avant celui de `ms`. */
function stepBack(ms: number, unit: Unit, n: number): number {
  const d = new Date(ms)
  // `Date.UTC` normalise un mois négatif (`-3` devient septembre de
  // l'année précédente) : c'est ce qui fait traverser le passage d'année
  // sans arithmétique modulaire, laquelle se trompe toujours d'un an la
  // première fois qu'on l'écrit.
  if (unit === "year") return Date.UTC(d.getUTCFullYear() - n, 0, 1)
  if (unit === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n)
}

/** La forme exacte des `x` d'Umami en UTC : `2026-08-01T00:00:00Z`. */
function bucketKey(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`
}

/**
 * La fenêtre à demander, et les seaux à en attendre.
 *
 * Alignée sur le début du seau : trente jours qui commenceraient au milieu
 * d'une journée donneraient un premier point tronqué, que le graphique
 * afficherait comme un creux. Le dernier seau, lui, est bien le seau
 * COURANT et donc partiel — c'est « aujourd'hui », et le masquer serait
 * plus déroutant que de le montrer.
 *
 * Pure, exportée, et testée seule : c'est toute l'arithmétique de dates de
 * ce module, et la seule partie qu'aucun appel réseau ne peut vérifier.
 */
export function fenetreFor(periode: Periode, now: number): Fenetre {
  const { unit, count } = GRANULARITES[periode]
  const dernier = bucketStart(now, unit)
  const buckets: string[] = []
  for (let i = count - 1; i >= 0; i--) buckets.push(bucketKey(stepBack(dernier, unit, i)))
  return { periode, unit, startAt: stepBack(dernier, unit, count - 1), endAt: now, buckets }
}

/**
 * La clé de seau d'une ligne d'Umami, ramenée à la forme engendrée ici.
 *
 * Pas une comparaison de chaînes brutes : `x` change de forme selon le
 * fuseau demandé (`2026-08-01T00:00:00Z` en UTC, `2026-08-01 00:00:00`
 * avec un fuseau nommé — sans indicateur de fuseau, donc lu en heure
 * locale par `new Date`). Reparser puis replancher fait que la jointure
 * survit à ce changement de forme au lieu de rendre douze zéros.
 */
function keyOf(x: string | undefined, unit: Unit): string | null {
  if (!x) return null
  const iso = x.trim().replace(" ", "T")
  const ms = Date.parse(/([zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`)
  if (Number.isNaN(ms)) return null
  return bucketKey(bucketStart(ms, unit))
}

export interface SiteSummary {
  /** La granularité effectivement servie — le défaut compris. */
  periode: Periode
  /** L'unité de seau demandée à Umami. */
  unit: Unit
  /** Les bornes de la fenêtre, en millisecondes. */
  startAt: number
  endAt: number
  totals: { pageviews: Metric; visitors: Metric } | null
  /**
   * Un point par seau de la fenêtre, dans l'ordre, seaux vides compris —
   * 30, 12 ou 5 selon la période. Jamais la liste creuse d'Umami.
   */
  series: SeriesPoint[] | null
  /**
   * `null` quand ce palmarès précis a échoué alors que le reste a répondu :
   * une liste manquante se signale, elle ne fait pas tomber l'écran.
   */
  topPages: RankedItem[] | null
  topReferrers: RankedItem[] | null
  status: AnalyticsResult["status"]
}

export interface UmamiLinks {
  /**
   * Où aller pour REGARDER les chiffres. Le lien de partage quand il est
   * activé — tableau de bord complet, lecture seule, aucune connexion —
   * sinon la racine d'Umami, qui en demandera une.
   */
  dashboard: string
  /** `true` quand `dashboard` est un partage, donc consultable sans compte. */
  shared: boolean
}

/**
 * L'adresse où REGARDER les chiffres d'Umami.
 *
 * Elle n'en rend qu'une : régler Umami se fait depuis Umami. Un second lien
 * « administrer » a existé ici et a été retiré — il menait à la racine, qui
 * demande une connexion que l'administration ne peut pas ouvrir (voir plus
 * bas), et il occupait une place à côté du seul lien qui rend un service.
 *
 * Une `query` et non des variables de build de l'admin : une seconde source
 * pourrait diverger de celle que les actions interrogent, et les liens
 * enverraient ailleurs que là où les chiffres sont lus. Elle ne rend que des
 * adresses — jamais le nom d'utilisateur ni le mot de passe, qui sont dans
 * le même bloc de configuration.
 *
 * **Il n'existe pas de troisième lien qui donnerait l'accès d'administration
 * sans connexion.** Vérifié contre 3.3.1 : `POST /api/auth/login` ne pose
 * aucun cookie, et le jeton qu'il rend est un blob chiffré gardé par le
 * navigateur. L'administration n'a donc aucun moyen d'ouvrir une session
 * Umami à votre place. La fabriquer supposerait de recopier
 * `UMAMI_APP_SECRET` dans un second service et d'y réimplémenter le
 * chiffrement d'Umami — un secret dupliqué et une réimplémentation qui
 * casse à la première montée de version. Faire voyager le jeton dans l'URL
 * serait pire encore : il ouvre un compte qui peut écrire, et une URL se
 * dépose dans l'historique, dans les en-têtes `Referer` et dans les
 * journaux de tout proxy traversé.
 */
export const umamiLinks = query({
  args: {},
  handler: async (ctx): Promise<UmamiLinks | null> => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    // `umamiLinks` est une QUERY : elle ne peut pas appeler `lireSecret`, qui
    // exige un contexte d'action pour déchiffrer. Elle reste donc sur
    // l'environnement, et c'est sans conséquence — elle ne lit qu'une URL et
    // un identifiant de partage, qui ne sont pas des secrets : ils
    // apparaissent dans la barre d'adresse de quiconque ouvre le tableau
    // Umami. Les identifiants de CONNEXION, eux, ne passent que par les
    // actions.
    const url = readUmamiConfig(process.env)?.url ?? null
    if (url === null) return null

    // Optionnelle, et elle doit le rester : un lien de partage est un
    // secret porteur, qui le détient voit les chiffres. L'activer est une
    // décision d'opérateur, pas un défaut qu'on impose.
    const shareId = process.env.UMAMI_API_SHARE_ID
    return {
      dashboard: shareId ? `${url}/share/${shareId}` : url,
      shared: Boolean(shareId),
    }
  },
})

async function getJson<T>(url: string, token: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) return null
  return (await response.json()) as T
}

/** Umami rend un referrer vide pour un accès direct — sans étiquette, la
 *  ligne serait illisible. */
function rank(rows: { x?: string; y?: number }[] | null): RankedItem[] | null {
  if (rows === null) return null
  return rows.map((row) => ({
    label: row.x && row.x.length > 0 ? row.x : "Accès direct",
    visits: row.y ?? 0,
  }))
}

export const siteSummary = action({
  // Optionnel, et le défaut est `jour` : l'accueil de l'administration
  // appelle sans argument et obtient exactement ce qu'il obtenait avant
  // que la granularité existe.
  args: { periode: v.optional(periodeValidator) },
  handler: async (ctx, args): Promise<SiteSummary> => {
    await requireRole(ctx, ["owner", "admin", "editor"])

    const fenetre = fenetreFor(args.periode ?? "mois", Date.now())
    const empty = {
      periode: fenetre.periode,
      unit: fenetre.unit,
      startAt: fenetre.startAt,
      endAt: fenetre.endAt,
      totals: null,
      series: null,
      topPages: null,
      topReferrers: null,
    }

    const cfg = await resoudreUmamiConfig(ctx)
    if (cfg === null) return { ...empty, status: "not-configured" }

    const now = fenetre.endAt
    const base = `${cfg.url}/api/websites/${cfg.websiteId}`
    // La MÊME fenêtre pour les quatre appels, et c'est ce qui rend la
    // comparaison honnête : Umami calcule sa période précédente comme la
    // fenêtre de MÊME DURÉE immédiatement antérieure à `startAt` (mesuré
    // contre 3.3.1 — une fenêtre de six heures rendait `comparison` à 278
    // vues, exactement le total mesuré directement sur les six heures
    // d'avant). Sur douze mois, la comparaison porte donc bien sur les
    // douze mois précédents, sans qu'on ait à la calculer.
    const window = `startAt=${fenetre.startAt}&endAt=${fenetre.endAt}`

    try {
      const token = await getUmamiToken(cfg, now)
      if (token === null) return { ...empty, status: "unauthorized" }

      // Quatre appels, lancés ensemble : en série, l'accueil attendrait
      // quatre allers-retours réseau avant son premier pixel.
      const [totals, series, pages, referrers] = await Promise.all([
        // `compare=prev` est explicite, pas obligatoire : mesuré contre
        // 3.3.1, `comparison` est rempli avec ou sans lui. Une version
        // antérieure de ce fichier affirmait le contraire — l'observation
        // reposait sur un facteur de confusion, la période précédente étant
        // vide dans chaque essai « sans drapeau ». Le drapeau reste parce
        // qu'il coûte zéro et dit ce qu'on attend, pas parce qu'il manque.
        getJson<RawStats>(`${base}/stats?${window}&compare=prev`, token),
        getJson<{
          sessions?: { x?: string; y?: number }[]
          pageviews?: { x?: string; y?: number }[]
        }>(
          // `timezone=UTC` explicite, alors qu'il est facultatif et que
          // l'instance fait déjà de l'UTC sans lui (vérifié : réponses
          // identiques). Ce qui change avec un fuseau NOMMÉ, c'est la
          // forme de `x` — `2026-08-01 00:00:00`, sans indicateur de
          // fuseau, que `new Date` lit en heure locale du navigateur et
          // qui décale le graphique d'un cran pour une partie des
          // lecteurs, jamais pour celui qui l'a développé s'il est à
          // Paris. Le figer ici fait qu'un changement de défaut chez
          // Umami casse un test plutôt que des dates.
          `${base}/pageviews?${window}&unit=${fenetre.unit}&timezone=UTC`,
          token,
        ),
        getJson<{ x?: string; y?: number }[]>(
          // `type=url` répond 400 en Umami 3 : le type s'appelle `path`.
          `${base}/metrics?${window}&type=path&limit=5`,
          token
        ),
        getJson<{ x?: string; y?: number }[]>(
          `${base}/metrics?${window}&type=referrer&limit=5`,
          token
        ),
      ])

      // Les totaux SONT le tableau de bord : sans eux il n'y a rien à
      // montrer, et l'écran le dit. Le test porte sur l'absence de la
      // réponse, jamais sur la valeur — un site sans visite rend zéro, et
      // zéro est une mesure, pas une panne.
      if (totals === null) return { ...empty, status: "unreachable" }

      // Umami construit `pageviews` et `sessions` séparément : rien ne
      // garantit qu'ils portent les mêmes seaux ni le même nombre. Les
      // apparier par indice décalerait tout ce qui suit un seau manquant,
      // silencieusement et de façon plausible. La clé `x` est ce qui les
      // relie réellement — et depuis que les seaux sont engendrés, c'est
      // elle aussi qui raccroche les deux tableaux à l'axe.
      const index = (rows: { x?: string; y?: number }[]) =>
        new Map(
          rows
            .map((row) => [keyOf(row.x, fenetre.unit), row.y ?? 0] as const)
            .filter((entry): entry is readonly [string, number] => entry[0] !== null),
        )
      const viewsByDate = index(series?.pageviews ?? [])
      const visitorsByDate = index(series?.sessions ?? [])
      return {
        periode: fenetre.periode,
        unit: fenetre.unit,
        startAt: fenetre.startAt,
        endAt: fenetre.endAt,
        totals: {
          pageviews: {
            value: totals.pageviews ?? 0,
            prev: totals.comparison?.pageviews ?? 0,
          },
          visitors: {
            value: totals.visitors ?? 0,
            prev: totals.comparison?.visitors ?? 0,
          },
        },
        // `null` seulement quand l'appel lui-même a échoué : un site sans
        // trafic rend une série de zéros, qui est une mesure, pas une panne.
        series:
          series === null
            ? null
            : fenetre.buckets.map((date) => ({
                date,
                visitors: visitorsByDate.get(date) ?? 0,
                pageviews: viewsByDate.get(date) ?? 0,
              })),
        topPages: rank(pages),
        topReferrers: rank(referrers),
        status: "ok",
      }
    } catch {
      return { ...empty, status: "unreachable" }
    }
  },
})

/**
 * Un lien d'arrivée directe sur Umami, déjà connecté.
 *
 * Une `action` : elle demande à Umami de frapper un jeton d'échange, ce
 * qu'une `query` ne peut pas faire.
 *
 * Le jeton qui voyage dans l'URL n'est PAS celui du compte. C'est un jeton
 * d'échange à usage unique et à vie courte, qu'Umami dépose dans Redis et
 * consomme à la première présentation — le mécanisme d'un lien magique.
 * L'identifiant et le mot de passe, eux, ne quittent jamais ce déploiement.
 * Sans Redis, `/api/auth/sso` répond « Redis is disabled » ; le lien devient
 * alors `null` et l'interface retombe sur la page de connexion d'Umami.
 *
 * **Réservé à owner et admin, et c'est le point de sécurité de ce module.**
 * Umami ouvre la session du compte configuré dans `UMAMI_API_USERNAME` : ce
 * lien ne délègue pas l'identité de la personne qui clique, il prête un
 * compte partagé. Le donner à un éditeur, ce serait lui donner tout ce que
 * ce compte peut faire dans Umami — pendant que les autres fonctions de ce
 * fichier, qui ne rendent que des chiffres, restent ouvertes aux trois rôles.
 */
export const ssoLink = action({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    await requireRole(ctx, ["owner", "admin"])

    const cfg = await resoudreUmamiConfig(ctx)
    if (cfg === null) return null

    try {
      const token = await getUmamiToken(cfg, Date.now())
      if (token === null) return null

      const response = await fetch(`${cfg.url}/api/auth/sso`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) return null

      const body = (await response.json()) as { token?: string }
      if (!body.token) return null

      // `url` est obligatoire : sans lui la page `/sso` consomme le jeton et
      // s'arrête sur un écran vide. Constaté, pas déduit.
      //
      // Elle vise la page du site mesuré, pas l'accueil d'Umami : on vient
      // de l'éditeur d'un site précis, et atterrir sur une liste de sites
      // ferait recommencer une navigation qu'on connaît déjà.
      const destination = encodeURIComponent(`/websites/${cfg.websiteId}`)
      return `${cfg.url}/sso?url=${destination}&token=${encodeURIComponent(body.token)}`
    } catch {
      return null
    }
  },
})

// Les trois actions publiques de ce module, déclarées au registre.
//
// Le garde-fou d'exhaustivité ne regardait que les mutations : ces trois-là
// y échappaient, alors qu'elles appellent toutes `requireRole`. Le trou
// était dans la preuve, pas dans le code — mais un garde-fou qui ne regarde
// qu'une moitié des portes n'en garde aucune.
MUTATION_REGISTRY.push(
  {
    name: "analytics.forPath",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: (t) => t.action(api.analytics.forPath, { path: "/" }),
  },
  {
    name: "analytics.siteSummary",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: (t) => t.action(api.analytics.siteSummary, {}),
  },
  {
    // Réservée : ce lien prête un compte Umami partagé, ce qui n'est pas
    // la même chose que lire des chiffres.
    name: "analytics.ssoLink",
    allowedRoles: ["owner", "admin"],
    invoke: (t) => t.action(api.analytics.ssoLink, {}),
  },
)

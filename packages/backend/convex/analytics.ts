import { v } from "convex/values"
import { action, query } from "./_generated/server"
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
 * écart — et il n'est rempli que si la requête porte `compare=prev`. Sans
 * ce drapeau il vaut zéro sans le dire, ce qui fait passer toute évolution
 * pour une progression depuis rien.
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
    },
    unauthorized: false,
  }
}

export const forPath = action({
  args: { path: v.string() },
  handler: async (ctx, args): Promise<AnalyticsResult> => {
    // Statistics are readable by anyone who can edit what they measure —
    // and by nobody else. The role is re-checked here, as in every other
    // Convex function: the UI hides, it does not decide.
    await requireRole(ctx, ["owner", "admin", "editor"])

    const cfg = readUmamiConfig(process.env)
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
  views: number
}

export interface SiteSummary {
  totals: { pageviews: Metric; visitors: Metric } | null
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
  /**
   * Où aller pour RÉGLER Umami : ajouter un site, créer un compte, activer
   * un partage. Toujours la racine, et toujours derrière une connexion.
   */
  admin: string
  /** `true` quand `dashboard` est un partage, donc consultable sans compte. */
  shared: boolean
}

/**
 * Les deux adresses d'Umami, pour les deux boutons de l'administration.
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
    const url = readUmamiConfig(process.env)?.url ?? null
    if (url === null) return null

    // Optionnelle, et elle doit le rester : un lien de partage est un
    // secret porteur, qui le détient voit les chiffres. L'activer est une
    // décision d'opérateur, pas un défaut qu'on impose.
    const shareId = process.env.UMAMI_API_SHARE_ID
    return {
      dashboard: shareId ? `${url}/share/${shareId}` : url,
      admin: url,
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
    views: row.y ?? 0,
  }))
}

export const siteSummary = action({
  args: {},
  handler: async (ctx): Promise<SiteSummary> => {
    await requireRole(ctx, ["owner", "admin", "editor"])

    const empty = {
      totals: null,
      series: null,
      topPages: null,
      topReferrers: null,
    }

    const cfg = readUmamiConfig(process.env)
    if (cfg === null) return { ...empty, status: "not-configured" }

    const now = Date.now()
    const startAt = String(now - 30 * DAY_MS)
    const endAt = String(now)
    const base = `${cfg.url}/api/websites/${cfg.websiteId}`
    const window = `startAt=${startAt}&endAt=${endAt}`

    try {
      const token = await getUmamiToken(cfg, now)
      if (token === null) return { ...empty, status: "unauthorized" }

      // Quatre appels, lancés ensemble : en série, l'accueil attendrait
      // quatre allers-retours réseau avant son premier pixel.
      const [totals, series, pages, referrers] = await Promise.all([
        // `compare=prev` est obligatoire : sans lui, `comparison` est rendu
        // à zéro sans erreur, et chaque tendance s'afficherait comme une
        // progression depuis rien.
        getJson<RawStats>(`${base}/stats?${window}&compare=prev`, token),
        getJson<{
          sessions?: { x?: string; y?: number }[]
          pageviews?: { x?: string; y?: number }[]
        }>(`${base}/pageviews?${window}&unit=day`, token),
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

      const points = series?.pageviews ?? null
      return {
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
        series:
          points === null
            ? null
            : points.map((point, index) => ({
                date: point.x ?? "",
                // Umami renvoie les deux séries dans le même ordre et sur
                // le même découpage ; l'index les apparie.
                visitors: series?.sessions?.[index]?.y ?? 0,
                pageviews: point.y ?? 0,
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

    const cfg = readUmamiConfig(process.env)
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
      return `${cfg.url}/sso?url=%2F&token=${encodeURIComponent(body.token)}`
    } catch {
      return null
    }
  },
})

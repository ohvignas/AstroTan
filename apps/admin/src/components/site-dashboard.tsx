import { useEffect, useState } from "react"
import { useAction } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type {
  Metric,
  SeriesPoint,
  SiteSummary,
  UmamiLinks,
} from "@astrotan/backend/convex/analytics"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExternalLinkIcon } from "lucide-react"

// L'accueil de l'administration : comment va le site, en un écran.
//
// Découpé comme `analytics-panel` : tout ce qui décide de l'affichage est
// une fonction pure de son résultat, et le conteneur ne fait que chercher.
// C'est ce qui rend chaque état — y compris les quatre pannes — vérifiable
// sans réseau et sans session.

/** Ce que chaque état non-`ok` veut dire, en une phrase sur le système. */
const EXPLANATIONS: Record<Exclude<SiteSummary["status"], "ok">, string> = {
  "not-configured":
    "Aucune mesure d'audience n'est configurée sur ce déploiement.",
  unreachable:
    "Le service de statistiques est injoignable. Les chiffres réapparaîtront dès qu'il répondra.",
  unauthorized:
    "Les identifiants de lecture ont été refusés. Vérifiez UMAMI_API_USERNAME et UMAMI_API_PASSWORD sur le déploiement Convex.",
}

/**
 * L'écart avec la période précédente, en pourcentage.
 *
 * `null` quand la période précédente est à zéro : une progression depuis
 * rien n'est pas « +100 % », c'est une division par zéro qu'aucun
 * pourcentage ne décrit honnêtement.
 */
export function trend(metric: Metric): number | null {
  if (metric.prev === 0) return null
  return Math.round(((metric.value - metric.prev) / metric.prev) * 100)
}

function Figure({ label, metric }: { label: string; metric: Metric }) {
  const change = trend(metric)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-3xl font-semibold tabular-nums">{metric.value}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {change === null
          ? "Pas de période de comparaison"
          : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change)} % vs 30 jours précédents`}
      </span>
    </div>
  )
}

/**
 * La courbe, en SVG écrit à la main.
 *
 * Une seule courbe ne justifie pas une bibliothèque de graphiques : ce qui
 * suit tient en quelques lignes, n'ajoute rien au bundle, et ne fige aucun
 * choix. À la deuxième courbe, la question se repose.
 */
export function Sparkline({ points }: { points: SeriesPoint[] }) {
  if (points.length < 2) return null

  const width = 600
  const height = 80
  const max = Math.max(...points.map((p) => p.visitors), 1)
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width
      // L'origine SVG est en haut : sans cette soustraction, la courbe est
      // dessinée à l'envers et personne ne le voit tout de suite.
      const y = height - (point.visitors / max) * height
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-20 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Visiteurs par jour, maximum ${max}`}
    >
      <path
        d={`${path} L${width},${height} L0,${height} Z`}
        className="fill-primary/10"
      />
      <path
        d={path}
        fill="none"
        className="stroke-primary"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function Ranking({
  title,
  items,
}: {
  title: string
  items: { label: string; visits: number }[] | null
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {title}
      </span>
      {items === null ? (
        // Une liste absente le dit. Une liste vide affichée comme telle se
        // lirait « personne », ce qui n'est pas ce qui s'est passé.
        <span className="text-sm text-muted-foreground">
          Liste indisponible pour le moment.
        </span>
      ) : items.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          Rien sur cette période.
        </span>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {items.map((item) => (
            <li key={item.label} className="flex justify-between gap-4">
              <span className="truncate">{item.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {item.visits}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SiteDashboard({
  summary,
  umami,
}: {
  /** `undefined` tant que l'action est en vol. */
  summary: SiteSummary | undefined
  umami: UmamiLinks | null | undefined
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audience du site</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {summary === undefined ? (
          <span className="text-sm text-muted-foreground">Chargement…</span>
        ) : summary.status !== "ok" || summary.totals === null ? (
          <span className="text-sm text-muted-foreground">
            {EXPLANATIONS[summary.status === "ok" ? "unreachable" : summary.status]}
          </span>
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-2">
              <Figure label="Visiteurs" metric={summary.totals.visitors} />
              <Figure label="Pages vues" metric={summary.totals.pageviews} />
            </div>

            {summary.series && summary.series.length >= 2 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  30 derniers jours
                </span>
                <Sparkline points={summary.series} />
              </div>
            )}

            <div className="grid gap-6 sm:grid-cols-2">
              {/* « visitées » et non « vues » : Umami compte ici une visite
                  par session, pas chaque affichage. Le chiffre était juste,
                  l'intitulé mentait — mesuré, `/` sortait à 2 visites pour
                  5 vues. */}
              <Ranking title="Pages les plus visitées" items={summary.topPages} />
              <Ranking title="D'où viennent-ils" items={summary.topReferrers} />
            </div>
          </>
        )}

        {umami && (
          <div className="flex flex-wrap gap-4">
            {/* Deux liens parce qu'il y a deux besoins, et qu'un seul
                intitulé les confondrait. Le partage ouvre les chiffres sans
                connexion, mais il est en LECTURE SEULE : ajouter un site ou
                changer un réglage passe par la racine et un mot de passe.
                Umami ne propose rien entre les deux — sa connexion ne pose
                aucun cookie et son jeton reste dans le navigateur, donc
                l'administration ne peut pas ouvrir de session à votre
                place. */}
            <a
              href={umami.dashboard}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm underline"
            >
              {umami.shared ? "Tout le détail" : "Ouvrir Umami"}
              <ExternalLinkIcon className="size-3" />
            </a>
            {umami.shared && (
              <a
                href={umami.admin}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-muted-foreground underline"
              >
                Administrer Umami (connexion requise)
                <ExternalLinkIcon className="size-3" />
              </a>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function SiteDashboardPanel({
  umami,
}: {
  umami: UmamiLinks | null | undefined
}) {
  const siteSummary = useAction(api.analytics.siteSummary)
  const [summary, setSummary] = useState<SiteSummary | undefined>(undefined)

  useEffect(() => {
    let current = true
    siteSummary({})
      .then((value) => {
        if (current) setSummary(value)
      })
      .catch(() => {
        // L'action traduit déjà toute panne prévisible en état. Ce qui
        // arrive ici ne l'était pas, et l'accueil doit quand même
        // s'afficher.
        if (current) {
          setSummary({
            totals: null,
            series: null,
            topPages: null,
            topReferrers: null,
            status: "unreachable",
          })
        }
      })
    return () => {
      current = false
    }
  }, [siteSummary])

  return <SiteDashboard summary={summary} umami={umami} />
}

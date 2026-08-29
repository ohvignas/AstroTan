import { useEffect, useState } from "react"
import { useAction } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type {
  Metric,
  Periode,
  SiteSummary,
  UmamiLinks,
} from "@astrotan/backend/convex/analytics"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExternalLinkIcon } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { CourbeAudience, SelecteurPeriode } from "@/components/audience-chart"
import { LIBELLES_PERIODE, nombre } from "@/lib/dashboardFormat"

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

function Figure({
  label,
  metric,
  fenetre,
}: {
  label: string
  metric: Metric
  /** « sur les 12 derniers mois » — la comparaison porte sur la MÊME durée. */
  fenetre: string
}) {
  const change = trend(metric)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-3xl font-semibold tabular-nums">{nombre(metric.value)}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {change === null
          ? "Pas de période de comparaison"
          : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change)} % ${fenetre}`}
      </span>
    </div>
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
  periode,
  onPeriode,
}: {
  /** `undefined` tant que l'action est en vol. */
  summary: SiteSummary | undefined
  umami: UmamiLinks | null | undefined
  periode: Periode
  onPeriode: (p: Periode) => void
}) {
  const fenetre = LIBELLES_PERIODE[periode].fenetre
  return (
    <Card>
      {/* Le titre et le sélecteur sur la même ligne : le second dit de quoi
          parle le premier, et les séparer obligerait à chercher la période
          en cours ailleurs que là où on lit les chiffres. */}
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <CardTitle>Audience du site</CardTitle>
          <span className="text-xs text-muted-foreground">{fenetre}</span>
        </div>
        <SelecteurPeriode
          periode={periode}
          onChange={onPeriode}
          disabled={summary === undefined}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {summary === undefined ? (
          <Skeleton className="h-[340px] rounded-lg" />
        ) : summary.status !== "ok" || summary.totals === null ? (
          <span className="text-sm text-muted-foreground">
            {EXPLANATIONS[summary.status === "ok" ? "unreachable" : summary.status]}
          </span>
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-2">
              <Figure
                label="Visiteurs"
                metric={summary.totals.visitors}
                fenetre={`vs période précédente`}
              />
              <Figure
                label="Pages vues"
                metric={summary.totals.pageviews}
                fenetre={`vs période précédente`}
              />
            </div>

            {summary.series && <CourbeAudience series={summary.series} periode={periode} />}

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
            {/* Un seul lien : regarder les chiffres. Régler Umami — ajouter
                un site, créer un compte, activer un partage — se fait depuis
                Umami lui-même, et n'a pas à occuper une place ici. Le lien
                change d'intitulé selon ce qu'il ouvre vraiment : un partage
                en lecture seule, ou la racine qui demandera une connexion. */}
            <a
              href={umami.dashboard}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm underline"
            >
              {umami.shared ? "Tout le détail" : "Ouvrir Umami"}
              <ExternalLinkIcon className="size-3" />
            </a>
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
  // « 30 jours » par défaut, et non « 7 jours » : sur un site neuf ou peu
  // visité, sept points suffisent rarement à faire une courbe lisible, et
  // l'écran ouvrirait sur un graphique presque plat.
  const [periode, setPeriode] = useState<Periode>("mois")
  const [summary, setSummary] = useState<SiteSummary | undefined>(undefined)

  useEffect(() => {
    let current = true
    // Remis à `undefined` à chaque changement de période : sans ça, les
    // chiffres de la période précédente restent affichés pendant que la
    // nouvelle arrive, et on lit des mois en croyant lire des jours.
    setSummary(undefined)
    siteSummary({ periode })
      .then((value) => {
        if (current) setSummary(value)
      })
      .catch(() => {
        // L'action traduit déjà toute panne prévisible en état. Ce qui
        // arrive ici ne l'était pas, et l'accueil doit quand même
        // s'afficher.
        if (current) {
          setSummary({
            periode,
            unit: "day",
            startAt: 0,
            endAt: 0,
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
  }, [siteSummary, periode])

  return (
    <SiteDashboard
      summary={summary}
      umami={umami}
      periode={periode}
      onPeriode={setPeriode}
    />
  )
}

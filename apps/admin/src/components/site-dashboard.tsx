import { useEffect, useState } from "react"
import { useAction, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type {
  Metric,
  Periode,
  SiteSummary,
  UmamiLinks,
} from "@astrotan/backend/convex/analytics"
import type { SiteSnapshot } from "@astrotan/backend/convex/lib/seoSnapshot"
import { ColonnePastillesSeo, listesSeo } from "@/components/pastille-seo"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExternalLinkIcon } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import {
  CadreSansMesure,
  CourbeAudience,
  SelecteurPeriode,
} from "@/components/audience-chart"
import {
  COURBE_INDISPONIBLE,
  LIBELLES_ETAT,
  LIBELLES_PERIODE,
  nombre,
} from "@/lib/dashboardFormat"

// L'accueil de l'administration : comment va le site, en un écran.
//
// Découpé comme `analytics-panel` : tout ce qui décide de l'affichage est
// une fonction pure de son résultat, et le conteneur ne fait que chercher.
// C'est ce qui rend chaque état — y compris les quatre pannes — vérifiable
// sans réseau et sans session.
//
// Le graphique est TOUJOURS rendu. Une panne d'Umami retirait le cadre et
// mettait une phrase à sa place ; l'écran n'avait alors plus de forme, et
// il devenait impossible de distinguer d'un coup d'œil « le service est
// muet » de « le site est calme ». Le cadre reste, et l'état se pose
// dessus (`CadreSansMesure`).

/**
 * Ce qu'il faut écrire sur le cadre quand il n'y a pas de courbe.
 *
 * Le cas `ok` en fait partie : Umami peut rendre les totaux et rater la
 * série. Le service a répondu, donc aucun des trois états de panne ne
 * décrit ce qui s'est passé — et une courbe à zéro le décrirait encore
 * moins.
 */
function etatDuCadre(summary: SiteSummary): string {
  return summary.status === "ok" ? COURBE_INDISPONIBLE : LIBELLES_ETAT[summary.status]
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
  missingDomain,
}: {
  title: string
  items: { label: string; visits: number }[] | null
  missingDomain?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {title}
      </span>
      {missingDomain ? (
        <a href="/settings/domaine" className="text-sm underline">
          Déclarez le domaine
        </a>
      ) : items === null ? (
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
  snapshot,
}: {
  /** `undefined` tant que l'action est en vol. */
  summary: SiteSummary | undefined
  umami: UmamiLinks | null | undefined
  periode: Periode
  onPeriode: (p: Periode) => void
  snapshot?: SiteSnapshot | null
}) {
  const fenetre = LIBELLES_PERIODE[periode].fenetre
  const showSeo = snapshot?.configured === true
  const seo = snapshot && showSeo ? listesSeo(snapshot) : null
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
        ) : (
          <>
            {/* Les chiffres n'apparaissent que mesurés. Les afficher à zéro
                sous un service muet serait affirmer « personne n'est venu »
                là où la vérité est « on ne sait pas ». */}
            {summary.totals && (
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
            )}

            <div
              className={
                showSeo ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_14rem]" : undefined
              }
            >
              {summary.status === "ok" && summary.series ? (
                <CourbeAudience series={summary.series} periode={periode} />
              ) : (
                <CadreSansMesure etat={etatDuCadre(summary)} />
              )}
              {showSeo && snapshot ? (
                <ColonnePastillesSeo snapshot={snapshot} />
              ) : null}
            </div>

            {summary.status === "ok" && (
              <div
                className={
                  showSeo
                    ? "grid gap-6 lg:grid-cols-4"
                    : "grid gap-6 sm:grid-cols-2"
                }
              >
                <Ranking title="Pages les plus visitées" items={summary.topPages} />
                <Ranking title="D'où viennent-ils" items={summary.topReferrers} />
                {showSeo && seo ? (
                  <>
                    <Ranking
                      title="Mots-clés qui amènent"
                      items={seo.keywords}
                      missingDomain={seo.domaineManquant}
                    />
                    <Ranking
                      title="Pages qui sortent déjà"
                      items={seo.pages}
                      missingDomain={seo.domaineManquant}
                    />
                  </>
                ) : null}
              </div>
            )}
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
  const snapshot = useQuery(api.seoRanks.siteSnapshot)
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
      snapshot={snapshot ?? null}
    />
  )
}

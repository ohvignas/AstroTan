import type { Periode, SiteSummary } from "@astrotan/backend/convex/analytics"
import type { SiteSnapshot } from "@astrotan/backend/convex/lib/seoSnapshot"
import type { SiteSeries } from "@astrotan/backend/convex/lib/seoSiteHistory"
import { ColonnePastillesSeo } from "@/components/pastille-seo"
import { CadreSansMesure, CourbeAudience } from "@/components/audience-chart"
import { CourbeSeo } from "@/components/courbe-seo"
import {
  COURBE_INDISPONIBLE,
  LIBELLES_ETAT,
} from "@/lib/dashboardFormat"
import { prochaineSerie, type SerieGraphe } from "@/lib/seoChartSeries"

function etatDuCadre(summary: SiteSummary): string {
  return summary.status === "ok" ? COURBE_INDISPONIBLE : LIBELLES_ETAT[summary.status]
}

export function DashboardGraphe({
  summary,
  periode,
  snapshot,
  history,
  serie,
  onSerie,
}: {
  summary: SiteSummary
  periode: Periode
  snapshot?: SiteSnapshot | null
  history?: SiteSeries | null
  serie: SerieGraphe
  onSerie: (s: SerieGraphe) => void
}) {
  const showSeo = snapshot?.configured === true
  const versVisites = () => onSerie(prochaineSerie(serie, "visites"))

  let cadre
  if (serie !== "visites") {
    const points = history?.[serie] ?? []
    cadre =
      points.length > 0 ? (
        <CourbeSeo points={points} periode={periode} metric={serie} />
      ) : (
        <CadreSansMesure etat={COURBE_INDISPONIBLE} />
      )
  } else if (summary.status === "ok" && summary.series && serie === "visites") {
    cadre = <CourbeAudience series={summary.series} periode={periode} />
  } else {
    cadre = <CadreSansMesure etat={etatDuCadre(summary)} />
  }

  return (
    <div
      className={showSeo ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_14rem]" : undefined}
    >
      <div className="flex min-w-0 flex-col gap-2">
        {showSeo ? (
          <button
            type="button"
            className={
              serie === "visites"
                ? "w-fit text-sm font-medium"
                : "w-fit text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
            }
            aria-pressed={serie === "visites"}
            onClick={versVisites}
          >
            Visites
          </button>
        ) : null}
        <div
          role="presentation"
          onClick={serie === "visites" ? undefined : versVisites}
        >
          {cadre}
        </div>
      </div>
      {showSeo && snapshot ? (
        <ColonnePastillesSeo
          snapshot={snapshot}
          serie={serie}
          onSerie={onSerie}
          visitesValue={summary.totals?.visitors.value}
        />
      ) : null}
    </div>
  )
}

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { Periode } from "@astrotan/backend/convex/analytics"
import type { RelevePoint } from "@astrotan/backend/convex/lib/seoSiteHistory"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { ChartConfig } from "@/components/ui/chart"
import { nombre } from "@/lib/dashboardFormat"
import { LIBELLES_SERIE, pointsPourCourbe, type SerieGraphe } from "@/lib/seoChartSeries"

const HAUTEUR = "h-[260px]"

const CONFIGS = {
  position: { rank: { label: LIBELLES_SERIE.position, color: "var(--chart-2)" } },
  backlinks: { backlinks: { label: LIBELLES_SERIE.backlinks, color: "var(--chart-2)" } },
  keywords: { keywords: { label: LIBELLES_SERIE.keywords, color: "var(--chart-2)" } },
} satisfies Record<Exclude<SerieGraphe, "visites">, ChartConfig>

const DATA_KEY = {
  position: "rank",
  backlinks: "backlinks",
  keywords: "keywords",
} as const

/**
 * Relevés SEO dans la fenêtre. `linear` + points : une droite entre deux
 * lundis, jamais une courbe lisse qui inventerait les jours du milieu.
 * Un seul point : le point et l'axe, pas une aire fantôme.
 */
export function CourbeSeo({
  points,
  periode,
  metric,
}: {
  points: RelevePoint[]
  periode: Periode
  metric: Exclude<SerieGraphe, "visites">
}) {
  const cle = DATA_KEY[metric]
  const donnees = pointsPourCourbe(points, periode).map((p) => ({
    etiquette: p.etiquette,
    [cle]: p.valeur,
  }))

  return (
    <ChartContainer
      data-etat="mesure"
      data-points={String(points.length)}
      config={CONFIGS[metric]}
      className={`${HAUTEUR} w-full`}
    >
      <AreaChart data={donnees} margin={{ left: 4, right: 4, top: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="etiquette"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval="preserveStartEnd"
          minTickGap={28}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          allowDecimals={metric === "position"}
          tickFormatter={(v: number) => nombre(v)}
        />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area
          dataKey={cle}
          type="linear"
          stroke={`var(--color-${cle})`}
          fill={`var(--color-${cle})`}
          fillOpacity={points.length > 1 ? 0.12 : 0}
          strokeWidth={2}
          dot={{ r: 4, strokeWidth: 2 }}
          activeDot={{ r: 5 }}
          connectNulls={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

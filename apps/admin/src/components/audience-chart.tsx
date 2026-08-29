import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { Periode, SiteSummary } from "@astrotan/backend/convex/analytics"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Button } from "@/components/ui/button"
import { etiquettePoint, nombre } from "@/lib/dashboardFormat"
import { LIBELLES_PERIODE } from "@/lib/dashboardFormat"

// La courbe d'audience, et le choix de sa granularité.
//
// Deux séries et non une, parce qu'elles ne disent pas la même chose : les
// pages vues comptent les affichages, les visiteurs comptent les sessions.
// Un site dont les vues montent pendant que les visiteurs stagnent n'a pas
// plus de public, il a un public qui lit davantage — et c'est la seule
// lecture que deux courbes superposées permettent d'un coup d'œil.

const CONFIG = {
  pageviews: { label: "Pages vues", color: "var(--chart-1)" },
  visitors: { label: "Visiteurs", color: "var(--chart-2)" },
} satisfies ChartConfig

export function SelecteurPeriode({
  periode,
  onChange,
  disabled,
}: {
  periode: Periode
  onChange: (p: Periode) => void
  disabled?: boolean
}) {
  return (
    // `aria-pressed` plutôt qu'un groupe de radios déguisé : ce sont trois
    // boutons qui changent la vue, et l'état actif se lit sans avoir à
    // deviner lequel des trois est « coché ».
    <div className="flex gap-1 rounded-lg border p-1" role="group" aria-label="Période">
      {(Object.keys(LIBELLES_PERIODE) as Periode[]).map((p) => (
        <Button
          key={p}
          type="button"
          size="sm"
          variant={periode === p ? "secondary" : "ghost"}
          aria-pressed={periode === p}
          disabled={disabled}
          onClick={() => onChange(p)}
        >
          {LIBELLES_PERIODE[p].onglet}
        </Button>
      ))}
    </div>
  )
}

export function CourbeAudience({
  series,
  periode,
}: {
  series: NonNullable<SiteSummary["series"]>
  periode: Periode
}) {
  // La série arrive dense — un point par seau, les seaux vides à zéro. Un
  // seul point ne fait pas une courbe, et une aire tracée sur un point rend
  // une bande plate qu'on lit comme une mesure constante.
  if (series.length < 2) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Pas encore assez de mesures pour tracer une courbe.
      </p>
    )
  }

  const donnees = series.map((point) => ({
    etiquette: etiquettePoint(point.date, periode),
    pageviews: point.pageviews,
    visitors: point.visitors,
  }))

  return (
    <ChartContainer config={CONFIG} className="h-[260px] w-full">
      <AreaChart data={donnees} margin={{ left: 4, right: 4, top: 4 }}>
        <defs>
          {/* Un dégradé par série, du plein au transparent : deux aires
              opaques superposées cachent celle du dessous. */}
          {(["pageviews", "visitors"] as const).map((cle) => (
            <linearGradient key={cle} id={`aire-${cle}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`var(--color-${cle})`} stopOpacity={0.35} />
              <stop offset="100%" stopColor={`var(--color-${cle})`} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>

        {/* Grille horizontale seule : les verticales n'apportent rien sur
            une série temporelle et hachent la lecture. */}
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="etiquette"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          // Un tick sur quelques-uns : trente étiquettes de jour se
          // chevauchent et deviennent illisibles avant d'être informatives.
          interval="preserveStartEnd"
          minTickGap={28}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          allowDecimals={false}
          tickFormatter={(v: number) => nombre(v)}
        />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area
          dataKey="pageviews"
          type="monotone"
          stroke="var(--color-pageviews)"
          fill="url(#aire-pageviews)"
          strokeWidth={2}
        />
        <Area
          dataKey="visitors"
          type="monotone"
          stroke="var(--color-visitors)"
          fill="url(#aire-visitors)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  )
}

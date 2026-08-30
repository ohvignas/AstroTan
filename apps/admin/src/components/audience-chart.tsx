import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { Periode, SiteSummary } from "@astrotan/backend/convex/analytics"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent

} from "@/components/ui/chart"
import type {ChartConfig} from "@/components/ui/chart";
import { Button } from "@/components/ui/button"
import { etiquettePoint, nombre, LIBELLES_PERIODE  } from "@/lib/dashboardFormat"

// La courbe d'audience, et le choix de sa granularité.
//
// Deux séries et non une, parce qu'elles ne disent pas la même chose : les
// pages vues comptent les affichages, les visiteurs comptent les sessions.
// Un site dont les vues montent pendant que les visiteurs stagnent n'a pas
// plus de public, il a un public qui lit davantage — et c'est la seule
// lecture que deux courbes superposées permettent d'un coup d'œil.
//
// Deux cadres, jamais un cadre et une phrase à sa place. Ils occupent la
// même hauteur et portent la même grille, si bien que l'écran ne saute pas
// quand on passe de l'un à l'autre, et `data-etat` dit lequel est rendu :
//
//   `mesure`        — Umami a répondu. La courbe est tracée, fût-elle
//                     plate à zéro : zéro visite est une MESURE.
//   `indisponible`  — Umami n'a pas répondu, ou n'est pas configuré, ou a
//                     refusé les identifiants. Le cadre est vide et le dit.
//                     Aucune courbe, et surtout aucun zéro — « on ne sait
//                     pas » et « personne n'est venu » sont deux choses
//                     différentes, et la seconde s'agit.
//
// La différence se voit sans lire : d'un côté deux aires colorées, de
// l'autre une grille nue. C'est ce qui rend inutile de comparer les mots.

// `--chart-2` et `--chart-5`, et non `--chart-1` et `--chart-2`.
//
// La palette de ce dashboard est en niveaux de gris, et `--chart-1` vaut
// `oklch(0.87 0 0)` : un trait de 2 px de ce gris sur une carte blanche
// (`oklch(1 0 0)`) tient un rapport de contraste d'environ 1,4:1, là où
// un élément graphique en demande 3. Comparé au navigateur, capture
// contre capture : la courbe des pages vues n'était pas absente, elle
// était PÂLE — par endroits plus pâle que la grille par-dessus laquelle
// elle passe. Les deux valeurs retenues (0.556 et 0.269) se lisent toutes
// deux, et se distinguent l'une de l'autre.
//
// Aucun jeton n'est redéfini : `styles.css` n'est pas touché, ce sont
// juste deux autres jetons de la même palette. Revenir en arrière tient
// donc en deux mots.
const CONFIG = {
  pageviews: { label: "Pages vues", color: "var(--chart-2)" },
  visitors: { label: "Visiteurs", color: "var(--chart-5)" },
} satisfies ChartConfig

/** La hauteur du tracé, partagée par les deux cadres. */
const HAUTEUR = "h-[260px]"

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
  // La série arrive dense — un point par seau, les seaux vides à zéro, 7,
  // 30 ou 12 points selon la période (`fenetreFor`). Un garde « moins de
  // deux points » a vécu ici : il était inatteignable, et il portait la
  // seule phrase capable de remplacer le graphique par du texte alors
  // qu'Umami avait répondu.
  const donnees = series.map((point) => ({
    etiquette: etiquettePoint(point.date, periode),
    pageviews: point.pageviews,
    visitors: point.visitors,
  }))

  return (
    <ChartContainer data-etat="mesure" config={CONFIG} className={`${HAUTEUR} w-full`}>
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
          // Aucun `domain` forcé, et c'est une décision mesurée : une série
          // entièrement à zéro rend déjà un axe `0 1 2 3 4` avec la courbe
          // plate posée sur le plancher — exactement ce qu'on veut voir.
          // Trois domaines ont été essayés au navigateur pour « aider »
          // ce cas ([0, max], [0, "dataMax"], [0, multiple de 4]) : le
          // deuxième centre la ligne à zéro au MILIEU du cadre, et les deux
          // autres cassent l'uniformité des graduations (`-1 4 9 16`). Le
          // défaut de recharts fait mieux que les trois.
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

/**
 * Le même cadre, sans mesure à y tracer.
 *
 * Écrit en SVG à la main plutôt qu'avec un `AreaChart` sans données : un
 * graphique vide de recharts fabrique quand même un axe, et cet axe porte
 * un « 0 » gradué qu'on lit comme une mesure. La grille ci-dessous ne
 * gradue rien — cinq lignes, aucune étiquette, aucun chiffre.
 *
 * Les 40 px de gouttière à gauche sont ceux de `YAxis width={40}`, et la
 * marge basse celle des étiquettes de l'axe des abscisses : les deux états
 * posent leur grille au même endroit.
 */
export function CadreSansMesure({ etat }: { etat: string }) {
  return (
    <div data-etat="indisponible" className={`relative ${HAUTEUR} w-full pb-6 pl-10`}>
      <svg
        // Décoratif : la grille ne porte aucune information, seul le texte
        // posé dessus en porte, et il est lu comme du texte.
        aria-hidden="true"
        className="size-full"
        preserveAspectRatio="none"
      >
        {["0%", "25%", "50%", "75%", "100%"].map((y) => (
          <line
            key={y}
            x1="0"
            x2="100%"
            y1={y}
            y2={y}
            strokeDasharray="3 3"
            className="stroke-border/50"
          />
        ))}
      </svg>
      {/* Posé SUR le cadre, jamais à sa place : c'est ce qui fait qu'un
          service en panne ne ressemble pas à un site sans visiteurs. */}
      <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {etat}
      </p>
    </div>
  )
}

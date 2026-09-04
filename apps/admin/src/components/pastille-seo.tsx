import type { ReactNode } from "react"
import type { SiteSnapshot } from "@astrotan/backend/convex/lib/seoSnapshot"
import { Indicateur } from "@/components/indicateur"
import { sensPourRang, sensPourVolume } from "@/components/fleche-tendance"
import {
  prochaineSerie,
  type SerieGraphe,
} from "@/lib/seoChartSeries"

export function PastilleSeo({
  label,
  value,
  sens,
  pressed = false,
  onSelect,
}: {
  label: string
  value: ReactNode
  sens: "up" | "down" | "flat"
  pressed?: boolean
  onSelect?: () => void
}) {
  const actif = pressed
    ? "rounded-lg bg-muted ring-2 ring-ring px-3 py-2"
    : "rounded-lg bg-muted/40 px-3 py-2"
  const inner = <Indicateur label={label} value={value} sens={sens} />
  if (!onSelect) {
    return <div className={actif}>{inner}</div>
  }
  return (
    <button
      type="button"
      className={`${actif} w-full text-left`}
      aria-pressed={pressed}
      onClick={onSelect}
    >
      {inner}
    </button>
  )
}

function LienDomaine() {
  return (
    <a href="/settings/domaine" className="underline">
      Déclarez le domaine
    </a>
  )
}

function formatMoyenne(value: number | null) {
  if (value === null) return "—"
  return Number.isInteger(value) ? value : value.toFixed(1)
}

export function ColonnePastillesSeo({
  snapshot,
  serie = "visites",
  onSerie,
  visitesValue,
}: {
  snapshot: SiteSnapshot
  serie?: SerieGraphe
  onSerie?: (s: SerieGraphe) => void
  visitesValue?: number
}) {
  const sansDomaine = !snapshot.declaredDomain
  const moyenne = snapshot.averagePosition
  const choisir = (cible: SerieGraphe) =>
    onSerie ? () => onSerie(prochaineSerie(serie, cible)) : undefined
  return (
    <div className="flex flex-col gap-3">
      {onSerie ? (
        <PastilleSeo
          label="Visites"
          value={visitesValue ?? "—"}
          sens="flat"
          pressed={serie === "visites"}
          onSelect={choisir("visites")}
        />
      ) : null}
      <PastilleSeo
        label="Position moyenne"
        value={formatMoyenne(moyenne)}
        sens={sensPourRang(moyenne ?? 0, snapshot.averagePositionPrev)}
        pressed={serie === "position"}
        onSelect={choisir("position")}
      />
      {sansDomaine ? (
        <>
          <PastilleSeo label="Backlinks" value={<LienDomaine />} sens="flat" />
          <PastilleSeo label="Mots-clés" value={<LienDomaine />} sens="flat" />
        </>
      ) : (
        <>
          <PastilleSeo
            label="Backlinks"
            value={snapshot.backlinks === null ? "—" : snapshot.backlinks.value}
            sens={
              snapshot.backlinks === null
                ? "flat"
                : sensPourVolume(snapshot.backlinks.value, snapshot.backlinks.prev)
            }
            pressed={serie === "backlinks"}
            onSelect={choisir("backlinks")}
          />
          <PastilleSeo
            label="Mots-clés"
            value={
              snapshot.keywordCount === 0 && snapshot.fetchedAt === null
                ? "—"
                : snapshot.keywordCount
            }
            sens="flat"
            pressed={serie === "keywords"}
            onSelect={choisir("keywords")}
          />
        </>
      )}
    </div>
  )
}

export function listesSeo(
  snapshot: SiteSnapshot,
): {
  keywords: { label: string; visits: number }[] | null
  domaineManquant: boolean
} {
  if (!snapshot.declaredDomain) {
    return { keywords: null, domaineManquant: true }
  }
  return {
    keywords: snapshot.keywords.map((k) => ({
      label: k.keyword,
      visits: k.position,
    })),
    domaineManquant: false,
  }
}

import type { ReactNode } from "react"
import type { SiteSnapshot } from "@astrotan/backend/convex/lib/seoSnapshot"
import { Indicateur } from "@/components/indicateur"
import { sensPourRang, sensPourVolume } from "@/components/fleche-tendance"

export function PastilleSeo({
  label,
  value,
  sens,
}: {
  label: string
  value: ReactNode
  sens: "up" | "down" | "flat"
}) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <Indicateur label={label} value={value} sens={sens} />
    </div>
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

export function ColonnePastillesSeo({ snapshot }: { snapshot: SiteSnapshot }) {
  const sansDomaine = !snapshot.declaredDomain
  const moyenne = snapshot.averagePosition
  return (
    <div className="flex flex-col gap-3">
      <PastilleSeo
        label="Position moyenne"
        value={formatMoyenne(moyenne)}
        sens={sensPourRang(moyenne ?? 0, snapshot.averagePositionPrev)}
      />
      {sansDomaine ? (
        <>
          <PastilleSeo label="Backlinks" value={<LienDomaine />} sens="flat" />
          <PastilleSeo
            label="Domaines référents"
            value={<LienDomaine />}
            sens="flat"
          />
        </>
      ) : snapshot.backlinks === null ? (
        <>
          <PastilleSeo label="Backlinks" value="Pas encore relevé" sens="flat" />
          <PastilleSeo
            label="Domaines référents"
            value="Pas encore relevé"
            sens="flat"
          />
        </>
      ) : (
        <>
          <PastilleSeo
            label="Backlinks"
            value={snapshot.backlinks.value}
            sens={sensPourVolume(snapshot.backlinks.value, snapshot.backlinks.prev)}
          />
          <PastilleSeo
            label="Domaines référents"
            value={snapshot.referringDomains?.value ?? "—"}
            sens={sensPourVolume(
              snapshot.referringDomains?.value ?? 0,
              snapshot.referringDomains?.prev ?? null,
            )}
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
  pages: { label: string; visits: number }[] | null
  domaineManquant: boolean
} {
  if (!snapshot.declaredDomain) {
    return { keywords: null, pages: null, domaineManquant: true }
  }
  return {
    keywords: snapshot.keywords.map((k) => ({
      label: k.keyword,
      visits: k.position,
    })),
    pages: snapshot.rankingPages.map((p) => ({
      label: p.path,
      visits: p.position,
    })),
    domaineManquant: false,
  }
}

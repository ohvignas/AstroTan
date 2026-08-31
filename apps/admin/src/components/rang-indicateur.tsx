import type { DocumentRank } from "@astrotan/backend/convex/lib/seoRankState"
import { Indicateur } from "@/components/indicateur"
import { sensPourRang } from "@/components/fleche-tendance"

function tronquer(url: string) {
  return url.length > 48 ? `${url.slice(0, 45)}…` : url
}

function valeurPosition(rank: DocumentRank) {
  switch (rank.state) {
    case "no_keyword":
      return "Aucun mot-clé cible."
    case "dfs_absent":
      return (
        <>
          DataForSEO n&apos;est pas configuré.{" "}
          <a href="/settings/mesure" className="underline">
            /settings/mesure
          </a>
        </>
      )
    case "never_ranked":
      return "Jamais relevé."
    case "keyword_changed":
      return `Mot-clé changé — le dernier relevé porte encore « ${rank.previousKeyword} »`
    case "out_of_top_100":
      return "Hors du top 100."
    case "other_url":
      return `Une autre URL ranke ${tronquer(rank.rankedUrl)}`
    case "ranked":
      return rank.position
  }
}

export function RangIndicateurs({ rank }: { rank: DocumentRank | undefined }) {
  if (rank === undefined) {
    return (
      <>
        <Indicateur label="Position" value="…" sens="flat" />
        <Indicateur label="Écart vs sem. préc." value="…" sens="flat" />
      </>
    )
  }
  if (rank.state === "ranked") {
    const precedent = rank.previousPosition ?? null
    const ecart = rank.gap
    return (
      <>
        <Indicateur
          label="Position"
          value={rank.position}
          sens={sensPourRang(rank.position, precedent)}
        />
        <Indicateur
          label="Écart vs sem. préc."
          value={ecart === undefined ? "—" : ecart}
          sens={
            ecart === undefined
              ? "flat"
              : sensPourRang(rank.position, precedent)
          }
        />
      </>
    )
  }
  return (
    <>
      <Indicateur label="Position" value={valeurPosition(rank)} sens="flat" />
      <Indicateur label="Écart vs sem. préc." value="—" sens="flat" />
    </>
  )
}

const LIBELLES_RELEVER = {
  not_found: "Document introuvable.",
  draft: "Publiez d'abord pour relever.",
  no_keyword: "Aucun mot-clé cible.",
  dfs_absent: "DataForSEO n'est pas configuré.",
  throttled: "Déjà relevé il y a moins d'une heure.",
  unreachable: "DataForSEO injoignable.",
  refuse: "Identifiants DataForSEO refusés.",
} as const

export function phraseRelever(reason: string | undefined): string {
  if (reason && reason in LIBELLES_RELEVER) {
    return LIBELLES_RELEVER[reason as keyof typeof LIBELLES_RELEVER]
  }
  return LIBELLES_RELEVER.unreachable
}

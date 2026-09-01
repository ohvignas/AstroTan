import { useState } from "react"
import { useAction, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import type { AnalyticsResult } from "@astrotan/backend/convex/analytics"
import type { DocumentRank } from "@astrotan/backend/convex/lib/seoRankState"
import { usePostAnalytics } from "@/lib/usePostAnalytics"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Indicateur } from "@/components/indicateur"
import { RefreshReleve } from "@/components/refresh-releve"
import { sensPourVolume } from "@/components/fleche-tendance"
import { phraseRelever, RangIndicateurs } from "@/components/rang-indicateur"
import { LIBELLES_ETAT } from "@/lib/dashboardFormat"
import { estThrottleReleve, raisonReleveInactif } from "@/lib/refreshReleve"

// Quatre indicateurs purs — Umami + rang. `PageAnalytics` cherche ;
// Relever n'existe qu'au clic, jamais au montage.

export function AnalyticsPanel({
  result,
  rank,
  onRelever,
  releverBusy,
  releverError,
}: {
  result: AnalyticsResult | undefined
  rank: DocumentRank | undefined
  onRelever?: () => void
  releverBusy?: boolean
  releverError?: string | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audience</CardTitle>
        <CardAction>
          <RefreshReleve
            busy={Boolean(releverBusy)}
            disabled={estThrottleReleve(rank)}
            disabledReason={raisonReleveInactif(rank)}
            lastRefreshedAt={rank?.fetchedAt}
            onClick={() => onRelever?.()}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {releverError ? (
          <p role="alert" className="text-destructive">
            {releverError}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-4">
          {result === undefined ? (
            <span className="col-span-2 text-muted-foreground">Chargement…</span>
          ) : result.status !== "ok" ? (
            <span className="col-span-2 text-muted-foreground">
              {LIBELLES_ETAT[result.status]}
            </span>
          ) : (
            <>
              <Indicateur
                label="Vues 7 j"
                value={result.last7!.pageviews}
                sens={sensPourVolume(
                  result.last7!.pageviews,
                  result.last7!.pageviewsPrev,
                )}
              />
              <Indicateur
                label="Visiteurs 30 j"
                value={result.last30!.visitors}
                sens={sensPourVolume(
                  result.last30!.visitors,
                  result.last30!.visitorsPrev,
                )}
              />
            </>
          )}
          <RangIndicateurs rank={rank} />
        </div>
      </CardContent>
    </Card>
  )
}

export function PageAnalytics({
  path,
  kind,
  pageId,
  postId,
}: {
  path: string | null
  kind: "page" | "post"
  pageId?: Id<"pages">
  postId?: Id<"posts">
}) {
  const relever = useAction(api.seoRanks.relever)
  const rankArgs =
    kind === "page" && pageId
      ? { kind, pageId }
      : kind === "post" && postId
        ? { kind, postId }
        : "skip"
  const rank = useQuery(api.seoRanks.forDocument, rankArgs)
  const result = usePostAnalytics(path)
  const [releverBusy, setReleverBusy] = useState(false)
  const [releverError, setReleverError] = useState<string | null>(null)

  async function handleRelever() {
    setReleverError(null)
    setReleverBusy(true)
    try {
      const out = await relever({ kind, pageId, postId })
      if (!out.ok) {
        setReleverError(phraseRelever(out.reason))
      }
    } catch {
      setReleverError(phraseRelever("unreachable"))
    } finally {
      setReleverBusy(false)
    }
  }

  return (
    <AnalyticsPanel
      result={result}
      rank={rank}
      onRelever={() => void handleRelever()}
      releverBusy={releverBusy}
      releverError={releverError}
    />
  )
}

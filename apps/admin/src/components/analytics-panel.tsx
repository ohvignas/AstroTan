import { useEffect, useState } from "react"
import { useAction, useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import type { AnalyticsResult } from "@astrotan/backend/convex/analytics"
import type { DocumentRank } from "@astrotan/backend/convex/lib/seoRankState"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Indicateur } from "@/components/indicateur"
import { sensPourVolume } from "@/components/fleche-tendance"
import { phraseRelever, RangIndicateurs } from "@/components/rang-indicateur"
import { LIBELLES_ETAT } from "@/lib/dashboardFormat"

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
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!rank?.canRelever || Boolean(releverBusy)}
            onClick={onRelever}
          >
            {releverBusy ? "Relevé…" : "Relever"}
          </Button>
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
  const forPath = useAction(api.analytics.forPath)
  const relever = useAction(api.seoRanks.relever)
  const rankArgs =
    kind === "page" && pageId
      ? { kind, pageId }
      : kind === "post" && postId
        ? { kind, postId }
        : "skip"
  const rank = useQuery(api.seoRanks.forDocument, rankArgs)
  const [result, setResult] = useState<AnalyticsResult | undefined>(undefined)
  const [releverBusy, setReleverBusy] = useState(false)
  const [releverError, setReleverError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    setResult(undefined)
    if (path === null) return
    forPath({ path })
      .then((value) => {
        if (current) setResult(value)
      })
      .catch(() => {
        if (current) {
          setResult({ last7: null, last30: null, status: "unreachable" })
        }
      })
    return () => {
      current = false
    }
  }, [forPath, path])

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

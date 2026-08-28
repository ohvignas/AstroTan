import { useEffect, useState } from "react"
import { useAction } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { AnalyticsResult } from "@astrotan/backend/convex/analytics"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// Audience figures beside the editor of the page they measure.
//
// Split in two on purpose. `AnalyticsPanel` is a pure function of a result
// — every state it can show is reachable from its props alone, which is
// what makes the states testable without a network, a session, or a DOM.
// `PageAnalytics` is the thin container that fetches; there is nothing in
// it worth asserting that the action's own tests do not already cover.

/**
 * What each non-`ok` status means to whoever is reading the screen.
 *
 * Every one of them is a sentence about the *system*, not about the page:
 * a page with no configured analytics has not "had zero visitors", and
 * saying so would be a lie the writer could act on.
 */
const EXPLANATIONS: Record<Exclude<AnalyticsResult["status"], "ok">, string> = {
  "not-configured":
    "Aucune mesure d'audience n'est configurée sur ce déploiement.",
  unreachable:
    "Le service de statistiques est injoignable. Les chiffres réapparaîtront dès qu'il répondra.",
  unauthorized:
    "Les identifiants de lecture ont été refusés. Vérifiez UMAMI_USERNAME et UMAMI_PASSWORD sur le déploiement Convex.",
}

function Window({
  label,
  stats,
}: {
  label: string
  stats: { pageviews: number; visitors: number }
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex items-baseline gap-3">
        {/* `tabular-nums` so the two windows' digits line up in the column
            rather than drifting with the glyph widths. */}
        <span className="text-2xl font-semibold tabular-nums">
          {stats.pageviews}
        </span>
        <span className="text-sm text-muted-foreground">
          vues · {stats.visitors} visiteurs
        </span>
      </div>
    </div>
  )
}

export function AnalyticsPanel({
  result,
}: {
  /** `undefined` while the action is in flight. */
  result: AnalyticsResult | undefined
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audience</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {result === undefined ? (
          <span className="text-muted-foreground">Chargement…</span>
        ) : result.status !== "ok" ? (
          <span className="text-muted-foreground">
            {EXPLANATIONS[result.status]}
          </span>
        ) : (
          <>
            {result.last7 && <Window label="7 derniers jours" stats={result.last7} />}
            {result.last30 && (
              <Window label="30 derniers jours" stats={result.last30} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function PageAnalytics({ path }: { path: string }) {
  const forPath = useAction(api.analytics.forPath)
  const [result, setResult] = useState<AnalyticsResult | undefined>(undefined)

  useEffect(() => {
    // An action is not reactive, so this fires once per path rather than on
    // every render — which is the reason the figures live behind an action
    // and not a query in the first place.
    let current = true
    setResult(undefined)
    forPath({ path })
      .then((value) => {
        if (current) setResult(value)
      })
      .catch(() => {
        // The action already converts every foreseeable failure into a
        // status. Anything reaching here is unforeseen, and the editor
        // still has to work: report it as unreachable rather than letting
        // it escape into an error boundary that would hide the form.
        if (current) {
          setResult({ last7: null, last30: null, status: "unreachable" })
        }
      })
    return () => {
      current = false
    }
  }, [forPath, path])

  return <AnalyticsPanel result={result} />
}

import { useEffect, useState } from "react"
import { useAction } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { AnalyticsResult } from "@astrotan/backend/convex/analytics"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LIBELLES_ETAT } from "@/lib/dashboardFormat"

// Audience figures beside the editor of the page they measure.
//
// Split in two on purpose. `AnalyticsPanel` is a pure function of a result
// — every state it can show is reachable from its props alone, which is
// what makes the states testable without a network, a session, or a DOM.
// `PageAnalytics` is the thin container that fetches; there is nothing in
// it worth asserting that the action's own tests do not already cover.
//
// What each non-`ok` status means is in `lib/dashboardFormat` — one copy,
// shared with the site dashboard. Every one of them is a sentence about
// the *system*, not about the page: a page with no configured analytics
// has not "had zero visitors", and saying so would be a lie the writer
// could act on.

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
            {LIBELLES_ETAT[result.status]}
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

export function PageAnalytics({ path }: { path: string | null }) {
  const forPath = useAction(api.analytics.forPath)
  const [result, setResult] = useState<AnalyticsResult | undefined>(undefined)

  useEffect(() => {
    // An action is not reactive, so this fires once per path rather than on
    // every render — which is the reason the figures live behind an action
    // and not a query in the first place.
    let current = true
    setResult(undefined)
    // `null` means the caller does not know the path *yet* — on the page
    // editor it waits for `settings.homePageSlug`, without which the home
    // page reads as `/accueil` and Umami is asked about an address that is
    // never served. The panel stays in its loading state rather than
    // spending a round trip on a question with a known-wrong answer.
    if (path === null) return
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

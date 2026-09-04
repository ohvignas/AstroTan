import { useEffect, useState } from "react"
import { RefreshCwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  CYCLE_MS,
  MOTS_RELEVE,
  formatRefreshAt,
  motEnCours,
} from "@/lib/refreshReleve"

function useCyclingWord(words: readonly string[], active: boolean) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!active) {
      setElapsed(0)
      return
    }
    const id = setInterval(() => {
      setElapsed((t) => t + CYCLE_MS)
    }, CYCLE_MS)
    return () => clearInterval(id)
  }, [active])
  return motEnCours(words, elapsed)
}

/**
 * Relance un relevé (DataForSEO, audience…) : icône qui tourne, mot gris
 * qui défile, puis la date du dernier snapshot.
 */
export function RefreshReleve({
  busy,
  disabled,
  disabledReason,
  lastRefreshedAt,
  now,
  pendingWords = MOTS_RELEVE,
  error,
  ariaLabel = "Relever",
  onClick,
}: {
  busy: boolean
  disabled: boolean
  disabledReason?: string
  lastRefreshedAt?: number
  now?: number
  pendingWords?: readonly string[]
  error?: string | null
  justSucceeded?: boolean
  ariaLabel?: string
  onClick: () => void
}) {
  const mot = useCyclingWord(pendingWords, busy)
  const hint = !busy && !error && disabledReason ? disabledReason : null
  const date =
    lastRefreshedAt !== undefined
      ? formatRefreshAt(lastRefreshedAt, now)
      : null
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        disabled={disabled || busy}
        onClick={onClick}
        title={disabledReason ?? ariaLabel}
        aria-label={busy ? "Relevé en cours" : ariaLabel}
        aria-busy={busy || undefined}
      >
        <RefreshCwIcon className={busy ? "animate-spin" : undefined} />
      </Button>
      {busy ? (
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {mot}
          {date ? <span className="block">{date}</span> : null}
        </span>
      ) : error ? (
        <span className="flex flex-col gap-0.5">
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
          {date ? (
            <span className="text-xs text-muted-foreground">{date}</span>
          ) : null}
        </span>
      ) : hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : date ? (
        <span className="text-xs text-muted-foreground">{date}</span>
      ) : null}
    </div>
  )
}

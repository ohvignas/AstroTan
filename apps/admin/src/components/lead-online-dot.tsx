import { useEffect, useState } from "react"
import { isOnline } from "@astrotan/backend/convex/lib/presenceWindow"

export function LeadOnlineDot({ lastSeenAt }: { lastSeenAt?: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(id)
  }, [])
  const online = isOnline(lastSeenAt, now)
  const label = online ? "En ligne" : "Hors ligne"

  return (
    <span
      aria-label={label}
      title={label}
      className="relative inline-flex size-3 shrink-0 items-center justify-center"
    >
      {online ? (
        <>
          <span
            aria-hidden="true"
            className="absolute size-3 rounded-full bg-emerald-400/50 animate-ping motion-reduce:hidden"
          />
          <span
            aria-hidden="true"
            className="absolute size-4 rounded-full bg-emerald-400/30 animate-ping [animation-delay:400ms] motion-reduce:hidden"
          />
          <span aria-hidden="true" className="relative size-2 rounded-full bg-emerald-500" />
        </>
      ) : (
        <span aria-hidden="true" className="relative size-2 rounded-full bg-destructive" />
      )}
    </span>
  )
}

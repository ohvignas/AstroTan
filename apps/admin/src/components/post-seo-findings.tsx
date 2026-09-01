import { phraseFinding } from "@/lib/yoastLabels"
import type { SeoFinding } from "@astrotan/backend/convex/lib/yoastFindings"

export function PostSeoFindings({
  findings,
  status,
}: {
  findings: SeoFinding[]
  status: "idle" | "loading" | "ready" | "error"
}) {
  if (status === "loading") {
    return <p className="text-xs text-muted-foreground">Analyse…</p>
  }
  if (status === "error") {
    return (
      <p role="alert" className="text-xs text-destructive">
        Analyse indisponible.
      </p>
    )
  }
  const missing = findings.filter((f) => f.severity === "missing")
  const improve = findings.filter((f) => f.severity === "improve")
  if (findings.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Rien à signaler pour le moment.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <FindingList title="Manque" items={missing} />
      <FindingList title="À améliorer" items={improve} />
    </div>
  )
}

function FindingList({
  title,
  items,
}: {
  title: string
  items: SeoFinding[]
}) {
  if (items.length === 0) return null
  return (
    <section>
      <h3 className="text-xs font-medium">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
        {items.map((item) => (
          <li key={item.identifier}>{phraseFinding(item.identifier)}</li>
        ))}
      </ul>
    </section>
  )
}

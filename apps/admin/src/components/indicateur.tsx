import type { ReactNode } from "react"
import { FlecheTendance, type SensTendance } from "@/components/fleche-tendance"

export function Indicateur({
  label,
  value,
  sens,
}: {
  label: string
  value: ReactNode
  sens: SensTendance
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <FlecheTendance sens={sens} />
      </div>
    </div>
  )
}

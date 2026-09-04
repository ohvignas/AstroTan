import type { ReactNode } from "react"

export const CONNECTOR_CARD_CLASS =
  "flex min-h-16 w-full items-center gap-3 rounded-xl bg-card px-3 py-2 ring-1 ring-foreground/10"

export function AgentConnectorCard({
  mark,
  title,
  subtitle,
  action,
}: {
  mark: ReactNode
  title: string
  subtitle: string
  action: ReactNode
}) {
  return (
    <div className={CONNECTOR_CARD_CLASS}>
      {mark}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </div>
  )
}

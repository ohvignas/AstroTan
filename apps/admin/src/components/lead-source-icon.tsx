import { BotIcon, MailIcon } from "lucide-react"
import type { LeadOrigin } from "@/lib/leadOrigin"

const LABELS: Record<LeadOrigin, string> = {
  chat: "Vient du chatbot",
  contact: "Vient du formulaire",
}

export function LeadSourceIcon({ source }: { source: LeadOrigin }) {
  const Icon = source === "chat" ? BotIcon : MailIcon
  return (
    <span
      aria-label={LABELS[source]}
      title={LABELS[source]}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border bg-background text-foreground"
    >
      <Icon aria-hidden="true" className="size-4 stroke-[2]" />
    </span>
  )
}

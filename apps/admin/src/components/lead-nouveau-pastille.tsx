import { Badge } from "@/components/ui/badge"
import { estLeadNouveau } from "@/lib/leadVu"

export function LeadNouveauPastille({ seenAt }: { seenAt?: number }) {
  if (!estLeadNouveau({ seenAt })) return null
  return (
    <Badge variant="secondary" className="h-4 px-1.5 text-[10px] leading-none">
      Nouveau
    </Badge>
  )
}

import type {
  FindingFamily,
  SeoFinding,
} from "@astrotan/backend/convex/lib/yoastFindings"
import type { CoachItem, CoachTone } from "@/components/coach-buckets"
import type { GeoCheckItem, GeoCheckStatus } from "@/lib/geoChecklist"
import { findingCopy } from "@/lib/yoastLabels"

/**
 * Les résultats Yoast d'une famille, réduits à ce que le panneau affiche :
 * une pastille, un titre de critère, une phrase.
 */
export function findingItems(
  findings: SeoFinding[],
  family: FindingFamily,
): CoachItem[] {
  return findings
    .filter((finding) => finding.family === family)
    .map((finding) => {
      const copy = findingCopy(finding.identifier, finding.rating)
      return {
        id: finding.identifier,
        tone: severityTone(finding.severity),
        title: copy.title,
        phrase: copy.phrase,
      }
    })
}

/** La checklist GEO, dans la même forme que les résultats Yoast. */
export function geoItems(items: GeoCheckItem[]): CoachItem[] {
  return items.map((item) => ({
    id: item.id,
    tone: geoTone(item.status),
    title: item.title,
    phrase: item.label,
  }))
}

function severityTone(severity: SeoFinding["severity"]): CoachTone {
  if (severity === "missing") return "bad"
  if (severity === "improve") return "ok"
  return "good"
}

function geoTone(status: GeoCheckStatus): CoachTone {
  if (status === "missing" || status === "blocked") return "bad"
  if (status === "pending" || status === "warn") return "ok"
  return "good"
}

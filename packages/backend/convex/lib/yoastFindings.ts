export type YoastRating = "error" | "feedback" | "bad" | "ok" | "good"

export type RawAssessment = {
  identifier: string
  rating: YoastRating
  score: number
}

export type FindingSeverity = "missing" | "improve"

export type SeoFinding = {
  identifier: string
  severity: FindingSeverity
  rating: YoastRating
}

const DROPPED = new Set(["titleWidth", "pageTitleWidth"])

export function toFindings(raw: RawAssessment[]): SeoFinding[] {
  const findings: SeoFinding[] = []
  for (const item of raw) {
    if (DROPPED.has(item.identifier)) continue
    if (item.rating === "good" || item.rating === "feedback") continue
    if (item.rating !== "bad" && item.rating !== "ok" && item.rating !== "error") {
      continue
    }
    findings.push({
      identifier: item.identifier,
      severity: item.rating === "ok" ? "improve" : "missing",
      rating: item.rating,
    })
  }
  return findings
}

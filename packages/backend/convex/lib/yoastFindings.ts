export type YoastRating = "error" | "feedback" | "bad" | "ok" | "good"

export type FindingFamily = "seo" | "readability"

export type RawAssessment = {
  identifier: string
  rating: YoastRating
  score: number
  family: FindingFamily
}

export type FindingSeverity = "missing" | "improve" | "good"

export type SeoFinding = {
  identifier: string
  severity: FindingSeverity
  rating: YoastRating
  family: FindingFamily
}

const DROPPED = new Set(["titleWidth", "pageTitleWidth"])

export function toFindings(raw: RawAssessment[]): SeoFinding[] {
  const findings: SeoFinding[] = []
  for (const item of raw) {
    if (DROPPED.has(item.identifier)) continue
    if (item.rating === "feedback") continue
    if (
      item.rating !== "bad" &&
      item.rating !== "ok" &&
      item.rating !== "error" &&
      item.rating !== "good"
    ) {
      continue
    }
    findings.push({
      identifier: item.identifier,
      severity:
        item.rating === "good"
          ? "good"
          : item.rating === "ok"
            ? "improve"
            : "missing",
      rating: item.rating,
      family: item.family,
    })
  }
  return findings
}

// yoastseo (GPL-3.0) — backend / action Node uniquement.
// Ne jamais importer ce module depuis apps/admin ou apps/web.
import { ContentAssessor, interpreters, Paper, SeoAssessor } from "yoastseo"
import FrenchResearcher from "yoastseo/build/languageProcessing/languages/fr/Researcher"
import { paperAttributes, type PaperFields } from "./yoastPaper"
import { toFindings, type RawAssessment, type SeoFinding } from "./yoastFindings"

export type YoastInput = PaperFields & { bodyHtml: string }

export type YoastOutput = { findings: SeoFinding[] }

function collect(assessor: {
  getValidResults: () => {
    getIdentifier: () => string
    getScore: () => number
  }[]
}): RawAssessment[] {
  return assessor.getValidResults().map((result) => ({
    identifier: result.getIdentifier(),
    score: result.getScore(),
    rating: interpreters.scoreToRating(result.getScore()),
  }))
}

export function runYoastAnalysis(input: YoastInput): YoastOutput {
  const attrs = paperAttributes(input)
  const paper = new Paper(input.bodyHtml, attrs)
  const researcher = new FrenchResearcher(paper)
  const seo = new SeoAssessor(researcher)
  seo.assess(paper)
  const read = new ContentAssessor(researcher)
  read.assess(paper)
  return { findings: toFindings([...collect(seo), ...collect(read)]) }
}

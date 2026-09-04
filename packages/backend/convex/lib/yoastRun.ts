// yoastseo (GPL-3.0) — backend / action Node uniquement.
// Ne jamais importer ce module depuis apps/admin ou apps/web.
// Les constructeurs sont injectés (createRequire dans seoAnalyze) : un
// import ESM de yoastseo ici ferait de ce fichier un point d'entrée V8
// qui casse le push, et `new Paper()` y recevrait le namespace CJS
// (« y is not a constructor »).
import { paperAttributes, type PaperFields } from "./yoastPaper"
import {
  toFindings,
  type FindingFamily,
  type RawAssessment,
  type SeoFinding,
  type YoastRating,
} from "./yoastFindings"

export type YoastEngine = {
  Paper: new (text: string, attributes: object) => unknown
  FrenchResearcher: new (paper: unknown) => unknown
  SeoAssessor: new (researcher: unknown) => YoastAssessor
  ContentAssessor: new (researcher: unknown) => YoastAssessor
  interpreters: { scoreToRating: (score: number) => YoastRating }
}

export type YoastInput = PaperFields & { bodyHtml: string; engine: YoastEngine }

export type YoastOutput = { findings: SeoFinding[] }

type YoastAssessor = {
  assess: (paper: unknown) => void
  getValidResults: () => { getIdentifier: () => string; getScore: () => number }[]
}

function collect(
  assessor: YoastAssessor,
  family: FindingFamily,
  scoreToRating: (score: number) => YoastRating,
): RawAssessment[] {
  return assessor.getValidResults().map((result) => ({
    identifier: result.getIdentifier(),
    score: result.getScore(),
    rating: scoreToRating(result.getScore()),
    family,
  }))
}

export function runYoastAnalysis(input: YoastInput): YoastOutput {
  const { engine } = input
  const scoreToRating = engine.interpreters.scoreToRating.bind(engine.interpreters)
  const paper = new engine.Paper(input.bodyHtml, paperAttributes(input))
  const researcher = new engine.FrenchResearcher(paper)
  const seo = new engine.SeoAssessor(researcher)
  seo.assess(paper)
  const read = new engine.ContentAssessor(researcher)
  read.assess(paper)
  return {
    findings: toFindings([
      ...collect(seo, "seo", scoreToRating),
      ...collect(read, "readability", scoreToRating),
    ]),
  }
}

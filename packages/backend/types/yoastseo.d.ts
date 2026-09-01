declare module "yoastseo" {
  export class Paper {
    constructor(
      text: string,
      attributes?: {
        keyword?: string
        synonyms?: string
        description?: string
        title?: string
        titleWidth?: number
        slug?: string
        locale?: string
        permalink?: string
        textTitle?: string
      },
    )
  }
  export class SeoAssessor {
    constructor(researcher: unknown, options?: object)
    assess(paper: Paper): void
    getValidResults(): YoastAssessmentResult[]
  }
  export class ContentAssessor {
    constructor(researcher: unknown, options?: object)
    assess(paper: Paper): void
    getValidResults(): YoastAssessmentResult[]
  }
  export const interpreters: {
    scoreToRating: (
      score: number,
    ) => "error" | "feedback" | "bad" | "ok" | "good"
  }
}

declare module "yoastseo/build/languageProcessing/languages/fr/Researcher" {
  import type { Paper } from "yoastseo"
  export default class FrenchResearcher {
    constructor(paper: Paper)
  }
}

export type YoastAssessmentResult = {
  getIdentifier: () => string
  getScore: () => number
  getText: () => string
}

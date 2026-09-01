import { describe, expect, test } from "vitest"
import { toFindings, type RawAssessment } from "./yoastFindings"

function raw(
  identifier: string,
  rating: RawAssessment["rating"],
): RawAssessment {
  return { identifier, rating, score: 3 }
}

describe("toFindings", () => {
  test("garde bad/ok/error, ignore good/feedback, drop titleWidth", () => {
    const out = toFindings([
      raw("keyphraseLength", "bad"),
      raw("textLength", "ok"),
      raw("titleWidth", "bad"),
      raw("pageTitleWidth", "bad"),
      raw("introductionKeyword", "good"),
      raw("transitionWords", "feedback"),
      raw("singleH1", "error"),
    ])
    expect(out.map((f) => f.identifier)).toEqual([
      "keyphraseLength",
      "textLength",
      "singleH1",
    ])
    expect(out[0]).toEqual({
      identifier: "keyphraseLength",
      severity: "missing",
      rating: "bad",
    })
    expect(out[1]?.severity).toBe("improve")
    expect(out[2]?.severity).toBe("missing")
  })
})

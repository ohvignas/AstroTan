import { describe, expect, test } from "vitest"
import { toFindings, type RawAssessment } from "./yoastFindings"

function raw(
  identifier: string,
  rating: RawAssessment["rating"],
  family: RawAssessment["family"] = "seo",
): RawAssessment {
  return { identifier, rating, score: 3, family }
}

describe("toFindings", () => {
  test("garde bad/ok/error/good, ignore feedback, drop titleWidth", () => {
    const out = toFindings([
      raw("keyphraseLength", "bad"),
      raw("textLength", "ok"),
      raw("titleWidth", "bad"),
      raw("pageTitleWidth", "bad"),
      raw("introductionKeyword", "good"),
      raw("transitionWords", "feedback", "readability"),
      raw("singleH1", "error"),
      raw("passiveVoice", "good", "readability"),
    ])
    expect(out.map((f) => f.identifier)).toEqual([
      "keyphraseLength",
      "textLength",
      "introductionKeyword",
      "singleH1",
      "passiveVoice",
    ])
    expect(out[0]).toEqual({
      identifier: "keyphraseLength",
      severity: "missing",
      rating: "bad",
      family: "seo",
    })
    expect(out[1]?.severity).toBe("improve")
    expect(out[2]?.severity).toBe("good")
    expect(out[4]).toEqual({
      identifier: "passiveVoice",
      severity: "good",
      rating: "good",
      family: "readability",
    })
  })
})


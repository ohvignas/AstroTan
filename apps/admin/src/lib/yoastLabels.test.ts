import { expect, test } from "vitest"
import { findingCopy, phraseFinding } from "./yoastLabels"

test("un identifier connu a un titre et une phrase FR", () => {
  const copy = findingCopy("keyphraseLength", "bad")
  expect(copy.title).toMatch(/mot-clé/i)
  expect(copy.phrase).toMatch(/mot-clé/i)
  expect(findingCopy("keyphraseLength", "good").phrase).toMatch(/ordre/i)
})

test("le titre Google, plus le titre SEO", () => {
  expect(findingCopy("titleKeyword").title).toMatch(/titre Google/i)
  expect(findingCopy("keyphraseInSEOTitle").phrase).toMatch(/titre Google/i)
  expect(findingCopy("titleKeyword").title).not.toMatch(/titre SEO/i)
})

test("un identifier inconnu reste lisible sans jeter", () => {
  expect(phraseFinding("unknownThing")).toBe(
    "Point à revoir (unknownThing).",
  )
})

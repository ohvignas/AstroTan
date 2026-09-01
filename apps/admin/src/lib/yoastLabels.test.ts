import { expect, test } from "vitest"
import { phraseFinding } from "./yoastLabels"

test("un identifier connu a une phrase FR", () => {
  expect(phraseFinding("keyphraseLength")).toMatch(/mot-clé/i)
})

test("un identifier inconnu reste lisible sans jeter", () => {
  expect(phraseFinding("unknownThing")).toBe(
    "Point à revoir (unknownThing).",
  )
})

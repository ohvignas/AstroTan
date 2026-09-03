import { describe, expect, test } from "vitest"
import { visitorPresenceLabel } from "./leadPresenceLabel"

describe("visitorPresenceLabel", () => {
  test("n'annonce le visiteur en ligne que s'il l'est vraiment", () => {
    expect(visitorPresenceLabel(true)).toBe("En ligne")
    expect(visitorPresenceLabel(false)).toBe("Hors ligne")
  })
})

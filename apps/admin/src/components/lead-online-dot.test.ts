import { describe, expect, test } from "vitest"
import source from "./lead-online-dot.tsx?raw"

describe("LeadOnlineDot", () => {
  test("ondes vertes en ligne, point rouge hors ligne, sans mouvement si reduced-motion", () => {
    expect(source).toContain("animate-ping")
    expect(source).toContain("bg-emerald-500")
    expect(source).toContain("bg-destructive")
    expect(source).toContain("motion-reduce:hidden")
    expect(source).toContain("En ligne")
    expect(source).toContain("Hors ligne")
  })
})

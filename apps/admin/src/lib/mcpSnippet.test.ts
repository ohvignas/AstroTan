import { describe, expect, test } from "vitest"
import { mcpSnippet } from "./mcpSnippet"

describe("mcpSnippet", () => {
  const snippet = mcpSnippet("https://x.convex.site")

  test("porte les variables d'environnement, sans secret", () => {
    expect(snippet).toContain("ASTROTAN_API_URL")
    expect(snippet).toContain("ASTROTAN_API_TOKEN")
    expect(snippet).toContain("https://x.convex.site")
    expect(snippet).toContain("@astrotan/mcp")
    expect(snippet).not.toMatch(/[0-9a-f]{64}/)
    expect(snippet).not.toMatch(/Bearer /)
  })
})

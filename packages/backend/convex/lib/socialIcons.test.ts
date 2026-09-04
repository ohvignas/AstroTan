import { expect, test } from "vitest"
import { SOCIAL_NETWORKS } from "./socialNetworks"
import { SOCIAL_ICONS } from "./socialIcons"

test("chaque réseau du catalogue a un tracé SVG", () => {
  for (const network of SOCIAL_NETWORKS) {
    const icon = SOCIAL_ICONS[network.id]
    expect(icon, network.id).toBeDefined()
    expect(icon.paths.length).toBeGreaterThan(20)
    expect(icon.variant === "stroke" || icon.variant === "fill").toBe(true)
  }
})

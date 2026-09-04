import { expect, test } from "vitest"
import { visibleSocials } from "./socialLinks"

test("n'affiche que les réseaux du catalogue qui ont un lien", () => {
  expect(
    visibleSocials([
      { label: "Instagram", url: "https://instagram.com/a" },
      { label: "Forum", url: "https://forum.exemple" },
      { label: "github", url: "   " },
    ]),
  ).toEqual([
    {
      id: "instagram",
      label: "Instagram",
      url: "https://instagram.com/a",
      icon: "social:instagram",
    },
  ])
})

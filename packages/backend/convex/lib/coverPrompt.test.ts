import { expect, test } from "vitest"
import { coverPrompt, pageOgPrompt } from "./coverPrompt"

test("le prompt image part du titre et interdit le texte dans l'image", () => {
  const prompt = coverPrompt({
    title: "Rénover une vitrine",
    excerpt: "Les trois gestes qui changent une rue.",
    targetKeyword: "vitrine commerçant",
    siteName: "Exemple",
  })
  expect(prompt).toContain("Rénover une vitrine")
  expect(prompt).toContain("vitrine commerçant")
  expect(prompt).toContain("Exemple")
  expect(prompt).toMatch(/Aucun texte|pas de.*texte/i)
  expect(prompt).toMatch(/16:9/)
})

test("le prompt OG de page porte titre, slug, mot-clé, marque et type", () => {
  const prompt = pageOgPrompt({
    title: "Nous écrire",
    slug: "contact",
    pageKind: "contact",
    targetKeyword: "contact artisan",
    siteName: "Atelier Nord",
  })
  expect(prompt).toContain("Nous écrire")
  expect(prompt).toContain("contact")
  expect(prompt).toContain("contact artisan")
  expect(prompt).toContain("Atelier Nord")
  expect(prompt).toMatch(/type de page\s*:\s*contact/i)
  expect(prompt).toMatch(/Aucun texte|pas de.*texte/i)
  expect(prompt).toMatch(/16:9/)
})

import { expect, test } from "vitest"
import { systemPrompt, userPrompt } from "./seoGeoPrompt"

test("le système d'une page d'accueil interdit d'inventer le légal et demande le contrat JSON", () => {
  const system = systemPrompt({
    kind: "page",
    title: "Accueil",
    slug: "accueil",
    siteName: "Exemple",
  })
  expect(system).toMatch(/seoTitle/)
  expect(system).toMatch(/n°1 Google|mot-clé/i)
  expect(system).toMatch(/SIRET/)
  expect(system).toMatch(/accueil|promesse/i)
})

test("un article demande le chapô et s'appuie sur le corps", () => {
  const system = systemPrompt({
    kind: "post",
    title: "Un billet",
    slug: "un-billet",
  })
  expect(system).toMatch(/excerpt/)
  expect(system).toMatch(/Chapô|corps/i)
})

test("le user injecte marque, mot-clé, domaine, SERP — et jamais un corps de page", () => {
  const page = userPrompt({
    kind: "page",
    title: "Contact",
    slug: "contact",
    siteName: "Exemple",
    declaredDomain: "exemple.fr",
    targetKeyword: "agence web lyon",
    serpLocationCode: 2250,
    serpLanguageCode: "fr",
    publicUrl: "https://exemple.fr/contact",
  })
  expect(page).toContain("agence web lyon")
  expect(page).toContain("exemple.fr")
  expect(page).toContain("France (Google)")
  expect(page).toContain("Pas de corps HTML")
  expect(page).not.toMatch(/"body"/)

  const post = userPrompt({
    kind: "post",
    title: "Un billet",
    slug: "un-billet",
    excerpt: "L'attaque.",
    body: "<p>Le développement secret.</p>",
  })
  expect(post).toContain("L'attaque.")
  expect(post).toContain("Le développement secret.")
  expect(post).toMatch(/mentions-legales|légal|SIRET|N'invente|corps/i)
})

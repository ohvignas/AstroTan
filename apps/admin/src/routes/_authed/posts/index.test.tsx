import { describe, expect, test } from "vitest"
import source from "./index.tsx?raw"

describe("modal Nouvel article — slug dérivé du titre", () => {
  test("câble slugSync : le titre remplit le slug à chaque frappe", () => {
    // Le défaut du screenshot : titre et slug sont deux useState
    // indépendants, donc « Les bases du vibecoding » laisse
    // « mon-premier-article » dans le champ. `saisirTitre` met à jour
    // le slug à chaque onChange, pas au blur.
    expect(source).toMatch(/from ["']@\/lib\/slugSync["']/)
    expect(source).toMatch(/saisirTitre\(/)
    expect(source).toMatch(/saisirSlug\(/)
  })

  test("la synchro n'attend pas le blur du titre", () => {
    expect(source).not.toMatch(/onBlur/)
  })
})

describe("colonne Auteur", () => {
  test("remplace les tags par l'auteur du post", () => {
    expect(source).toMatch(/<TableHead>Auteur<\/TableHead>/)
    expect(source).not.toMatch(/<TableHead>Tags<\/TableHead>/)
    expect(source).not.toMatch(/api\.tags\.list/)
    expect(source).toMatch(/post\.author\??\.displayName/)
  })

  test("garde titre, statut et date de publication", () => {
    expect(source).toMatch(/<TableHead>Titre<\/TableHead>/)
    expect(source).toMatch(/<TableHead>Statut<\/TableHead>/)
    expect(source).toMatch(/<TableHead>Publié le<\/TableHead>/)
  })
})

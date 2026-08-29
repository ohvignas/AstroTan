import { describe, expect, test } from "vitest"
import { estHoteNu, normaliserHote } from "./hoteNu"

describe("estHoteNu", () => {
  test("accepte un domaine ordinaire et un sous-domaine", () => {
    expect(estHoteNu("exemple.fr")).toBe(true)
    expect(estHoteNu("admin.exemple.fr")).toBe(true)
    expect(estHoteNu("a-b.exemple.co.uk")).toBe(true)
  })

  test("refuse tout ce qui n'est pas un hôte", () => {
    // Ce sont exactement les formes qui font lever `domainesAutorises`
    // dans `apps/web/src/lib/allowedDomains.ts` : un schéma, un port ou un
    // chemin produisent un motif qu'Astro n'appariera jamais, donc une
    // validation d'hôte silencieusement inerte.
    for (const mauvais of [
      "https://exemple.fr",
      "exemple.fr:4321",
      "exemple.fr/chemin",
      "*.exemple.fr",
      "exemple",
      "",
      "   ",
      "-exemple.fr",
      "exemple-.fr",
    ]) {
      expect(estHoteNu(mauvais), mauvais).toBe(false)
    }
  })
})

describe("normaliserHote", () => {
  test("met en minuscules, retire les espaces et le point final", () => {
    expect(normaliserHote("  Exemple.FR.  ")).toBe("exemple.fr")
  })

  test("rend null quand la valeur n'est pas récupérable", () => {
    expect(normaliserHote("https://exemple.fr")).toBeNull()
    expect(normaliserHote("")).toBeNull()
  })
})

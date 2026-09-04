import { describe, expect, test } from "vitest"
import { estHoteNu, hotePublicDepuisEnv, normaliserHote } from "./hoteNu"

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

describe("hotePublicDepuisEnv", () => {
  test("prend WEB_DOMAIN s'il est un hôte nu", () => {
    expect(
      hotePublicDepuisEnv({
        WEB_DOMAIN: "  AstroTan.Illith.com.  ",
        WEB_SITE_URL: "https://autre.fr",
      }),
    ).toBe("astrotan.illith.com")
  })

  test("replie sur l'hôte de WEB_SITE_URL quand WEB_DOMAIN manque", () => {
    expect(hotePublicDepuisEnv({ WEB_SITE_URL: "https://astrotan.illith.com" })).toBe(
      "astrotan.illith.com",
    )
  })

  test("refuse localhost et une URL illisible", () => {
    expect(hotePublicDepuisEnv({ WEB_SITE_URL: "http://localhost:4321" })).toBeNull()
    expect(hotePublicDepuisEnv({ WEB_DOMAIN: "localhost" })).toBeNull()
    expect(hotePublicDepuisEnv({ WEB_SITE_URL: "pas-une-url" })).toBeNull()
    expect(hotePublicDepuisEnv({})).toBeNull()
  })
})

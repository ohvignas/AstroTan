import { afterEach, describe, expect, test, vi } from "vitest"
import {
  estUrlLogoEmail,
  garantirLogoEmail,
  piedEmail,
  urlLogoEmail,
} from "./emailLogo"

describe("estUrlLogoEmail", () => {
  test("refuse ce que Gmail ne peut pas charger", () => {
    expect(estUrlLogoEmail("javascript:alert(1)")).toBe(false)
    expect(estUrlLogoEmail("http://localhost:4321/logo")).toBe(false)
    expect(estUrlLogoEmail("http://127.0.0.1/logo")).toBe(false)
    expect(estUrlLogoEmail("https://happy-animal-123.convex.cloud/api/storage/kg")).toBe(
      false,
    )
    expect(estUrlLogoEmail("https://happy-animal-123.convex.site/api/storage/kg")).toBe(
      false,
    )
  })

  test("accepte une HTTPS publique hors storage Convex", () => {
    expect(estUrlLogoEmail("https://illith.com/logo")).toBe(true)
    expect(estUrlLogoEmail("https://cdn.exemple.fr/logo.png")).toBe(true)
  })
})

describe("urlLogoEmail", () => {
  test("ne construit rien depuis une origine locale ou absente", () => {
    expect(urlLogoEmail(null)).toBeNull()
    expect(urlLogoEmail("http://localhost:4321")).toBeNull()
    expect(urlLogoEmail("http://127.0.0.1:4321")).toBeNull()
  })

  test("compose {origine}/logo sur une origine publique", () => {
    expect(urlLogoEmail("https://illith.com")).toBe("https://illith.com/logo")
    expect(urlLogoEmail("https://illith.com/")).toBe("https://illith.com/logo")
  })
})

describe("piedEmail", () => {
  test("le domaine déclaré l'emporte, sans répéter le nom du site", () => {
    expect(piedEmail("illith.com", "https://illith.com")).toBe("illith.com")
    expect(piedEmail("  Exemple.FR. ", "http://localhost:4321")).toBe("exemple.fr")
  })

  test("sans domaine déclaré, l'hôte public du site, jamais localhost", () => {
    expect(piedEmail(null, "https://studio-nord.fr")).toBe("studio-nord.fr")
    expect(piedEmail(null, "http://localhost:4321")).toBeNull()
    expect(piedEmail(null, null)).toBeNull()
  })
})

describe("garantirLogoEmail", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("une 404 ou une origine locale ne produit pas d'URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    )
    expect(await garantirLogoEmail("https://illith.com/logo")).toBeNull()
    expect(await garantirLogoEmail("http://localhost:4321/logo")).toBeNull()
  })

  test("une image HTTPS joignable passe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, {
        status: 200,
        headers: { "content-type": "image/png" },
      })),
    )
    expect(await garantirLogoEmail("https://illith.com/logo")).toBe(
      "https://illith.com/logo",
    )
  })
})

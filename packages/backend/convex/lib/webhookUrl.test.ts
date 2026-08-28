import { describe, expect, test } from "vitest"
import { refuseWebhookUrl } from "./webhookUrl"

describe("refuseWebhookUrl", () => {
  test("accepte une URL de scénario ordinaire", () => {
    expect(refuseWebhookUrl("https://hook.eu2.make.com/abc123")).toBeNull()
    expect(refuseWebhookUrl("https://n8n.exemple.fr/webhook/leads")).toBeNull()
  })

  test("refuse ce qui n'est pas chiffré", () => {
    // Le corps d'un message de contact voyagerait lisible par tout
    // intermédiaire.
    expect(refuseWebhookUrl("http://hook.exemple.fr/leads")).toBe("NOT_HTTPS")
    expect(refuseWebhookUrl("ftp://exemple.fr")).toBe("NOT_HTTPS")
  })

  test("refuse l'adresse de métadonnées de l'hébergeur", () => {
    // Celle-ci avant toutes les autres : elle rend des jetons d'identité,
    // pas seulement des données.
    expect(refuseWebhookUrl("https://169.254.169.254/latest/meta-data/")).toBe(
      "INTERNAL_ADDRESS",
    )
    expect(refuseWebhookUrl("https://metadata.google.internal/")).toBe(
      "INTERNAL_ADDRESS",
    )
  })

  test.each([
    "https://localhost/hook",
    "https://127.0.0.1/hook",
    "https://10.0.0.5/hook",
    "https://172.16.0.1/hook",
    "https://172.31.255.254/hook",
    "https://192.168.1.10/hook",
    "https://[::1]/hook",
    "https://intranet.local/hook",
    "https://db.internal/hook",
  ])("refuse l'adresse interne %s", (url) => {
    expect(refuseWebhookUrl(url)).toBe("INTERNAL_ADDRESS")
  })

  test("laisse passer une adresse publique qui ressemble à une privée", () => {
    // 172.32 est PUBLIQUE : la plage privée s'arrête à 172.31. Coder
    // « 172.» tout court aurait refusé des destinations légitimes.
    expect(refuseWebhookUrl("https://172.32.0.1/hook")).toBeNull()
    expect(refuseWebhookUrl("https://11.0.0.1/hook")).toBeNull()
  })

  test("refuse ce qui n'est pas une URL, et ce qui est démesuré", () => {
    expect(refuseWebhookUrl("pas une url")).toBe("NOT_A_URL")
    expect(refuseWebhookUrl("")).toBe("NOT_A_URL")
    expect(refuseWebhookUrl("https://exemple.fr/" + "x".repeat(2_100))).toBe("TOO_LONG")
  })
})

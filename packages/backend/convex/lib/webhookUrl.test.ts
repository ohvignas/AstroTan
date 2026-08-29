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

  test.each([
    "https://2130706433/hook", // décimale : 127.0.0.1
    "https://0177.0.0.1/hook", // octale : 127.0.0.1
    "https://0x7f000001/hook", // hexadécimale : 127.0.0.1
  ])("refuse la forme numérique %s", (url) => {
    // Tests de non-régression, pas des tests du parsing : aucun code de
    // ce fichier n'interprète le décimal/l'octal/l'hexadécimal. Ces formes
    // sont déjà canonicalisées en notation pointée par `new URL()`
    // elle-même (le parseur d'hôte de la spec WHATWG URL) avant que
    // `isPrivateIpv4` ne voie le hostname — voir le commentaire d'en-tête.
    expect(refuseWebhookUrl(url)).toBe("INTERNAL_ADDRESS")
  })

  test.each([
    "https://[::]/hook", // IPv6 non spécifiée, traitée comme boucle locale par beaucoup de piles
    "https://[::ffff:127.0.0.1]/hook", // IPv4-mappée en IPv6
  ])("refuse la forme IPv6 %s", (url) => {
    expect(refuseWebhookUrl(url)).toBe("INTERNAL_ADDRESS")
  })

  test("laisse passer une adresse publique qui ressemble à une privée", () => {
    // 172.32 est PUBLIQUE : la plage privée s'arrête à 172.31. Coder
    // « 172.» tout court aurait refusé des destinations légitimes.
    expect(refuseWebhookUrl("https://172.32.0.1/hook")).toBeNull()
    expect(refuseWebhookUrl("https://11.0.0.1/hook")).toBeNull()
  })

  test.each([
    "https://[2001:db8::1]/hook",
    "https://[2606:4700:4700::1111]/hook", // résolveur DNS public de Cloudflare
  ])("laisse passer une adresse IPv6 publique qui se termine par ::1 %s", (url) => {
    // `.includes("::1")` sur le hostname aurait refusé ces deux adresses
    // publiques par simple sous-chaîne — seule `::1` exactement doit être
    // la boucle locale refusée (couvert plus haut, "refuse l'adresse
    // interne https://[::1]/hook").
    expect(refuseWebhookUrl(url)).toBeNull()
  })

  test("refuse ce qui n'est pas une URL, et ce qui est démesuré", () => {
    expect(refuseWebhookUrl("pas une url")).toBe("NOT_A_URL")
    expect(refuseWebhookUrl("")).toBe("NOT_A_URL")
    expect(refuseWebhookUrl("https://exemple.fr/" + "x".repeat(2_100))).toBe("TOO_LONG")
  })
})

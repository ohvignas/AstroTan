import { describe, expect, test } from "vitest"
import { countryFlag, formatLeadLocation, isLocalIp, leadHeadline } from "./leadLocation"

describe("countryFlag", () => {
  test("FR devient le drapeau français", () => {
    expect(countryFlag("FR")).toBe("🇫🇷")
    expect(countryFlag("fr")).toBe("🇫🇷")
  })

  test("code invalide ou inconnu : pas de drapeau", () => {
    expect(countryFlag(undefined)).toBeNull()
    expect(countryFlag("")).toBeNull()
    expect(countryFlag("XX")).toBeNull()
    expect(countryFlag("France")).toBeNull()
  })
})

describe("leadHeadline", () => {
  test("avec e-mail, le nom de la fiche", () => {
    expect(leadHeadline({ name: "Ada", email: "ada@example.com", ip: "203.0.113.42" })).toBe(
      "Ada",
    )
  })

  test("sans e-mail, Visiteur · IP", () => {
    expect(leadHeadline({ name: "Visiteur", ip: "203.0.113.42" })).toBe(
      "Visiteur · 203.0.113.42",
    )
  })

  test("sans e-mail, l'IP loopback s'affiche telle quelle, pas « local »", () => {
    expect(leadHeadline({ name: "Visiteur", ip: "127.0.0.1" })).toBe("Visiteur · 127.0.0.1")
    expect(leadHeadline({ name: "Visiteur", ip: "::1" })).toBe("Visiteur · ::1")
  })
})

describe("isLocalIp", () => {
  test("reconnaît le loopback", () => {
    expect(isLocalIp("127.0.0.1")).toBe(true)
    expect(isLocalIp("::1")).toBe(true)
    expect(isLocalIp("203.0.113.42")).toBe(false)
  })
})

describe("formatLeadLocation", () => {
  test("affiche drapeau, ville, pays et IP", () => {
    expect(formatLeadLocation({ city: "Lyon", country: "FR", ip: "203.0.113.42" })).toBe(
      "🇫🇷 Lyon, FR · 203.0.113.42",
    )
  })

  test("sans ville, le drapeau, le pays et l'IP suffisent", () => {
    expect(formatLeadLocation({ country: "FR", ip: "203.0.113.42" })).toBe(
      "🇫🇷 FR · 203.0.113.42",
    )
  })

  test("sans geo, l'IP seule", () => {
    expect(formatLeadLocation({ ip: "203.0.113.42" })).toBe("203.0.113.42")
  })

  test("IP loopback sans pays : l'adresse, pas le libellé « local »", () => {
    expect(formatLeadLocation({ ip: "127.0.0.1" })).toBe("127.0.0.1")
    expect(formatLeadLocation({ ip: "::1" })).toBe("::1")
  })

  test("rien à afficher", () => {
    expect(formatLeadLocation({})).toBeNull()
  })
})

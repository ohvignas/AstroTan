import { describe, expect, test } from "vitest"
import {
  DEFAULT_VISITOR_TIMEZONE,
  formatVisitorContextBlock,
  type VisitorContextInput,
} from "./visitorContext"

const FRIDAY_MORNING_PARIS = Date.parse("2026-09-04T02:19:00+02:00")

function facts(overrides: Partial<VisitorContextInput> = {}): VisitorContextInput {
  return {
    nowMs: FRIDAY_MORNING_PARIS,
    siteName: null,
    language: "fr",
    pageUrl: null,
    country: null,
    city: null,
    ip: null,
    latitude: null,
    longitude: null,
    timeZone: null,
    leadEmail: null,
    leadName: null,
    calendarConnected: false,
    ...overrides,
  }
}

describe("formatVisitorContextBlock", () => {
  test("la date du jour est toujours présente, ISO et lisible FR", () => {
    const block = formatVisitorContextBlock(facts())
    expect(block).toContain("2026-09-04")
    expect(block).toMatch(/vendredi 4 septembre 2026/i)
    expect(block).toContain("02:19")
    expect(block).toContain(DEFAULT_VISITOR_TIMEZONE)
    expect(block).toMatch(/ne (les )?redemande pas|ne demande pas la date/i)
  })

  test("demain est calculé, sans demander JJ/MM au visiteur", () => {
    const block = formatVisitorContextBlock(facts())
    expect(block).toContain("2026-09-05")
    expect(block).toMatch(/samedi 5 septembre 2026/i)
    expect(block).not.toMatch(/JJ\/MM/)
  })

  test("127.0.0.1 sans pays ne devient pas Paris", () => {
    const block = formatVisitorContextBlock(facts({ ip: "127.0.0.1" }))
    expect(block).toMatch(/Localisation visiteur : local \/ inconnue/)
    expect(block).not.toMatch(/Localisation visiteur :.*Paris/)
  })

  test("::1 sans ville non plus", () => {
    const block = formatVisitorContextBlock(facts({ ip: "::1" }))
    expect(block).toMatch(/Localisation visiteur : local \/ inconnue/)
    expect(block).not.toMatch(/Localisation visiteur :.*Paris/)
  })

  test("Lyon / FR s'affiche, avec coordonnées si déjà là", () => {
    const block = formatVisitorContextBlock(
      facts({
        country: "FR",
        city: "Lyon",
        ip: "203.0.113.42",
        latitude: 45.75,
        longitude: 4.85,
      }),
    )
    expect(block).toContain("Lyon")
    expect(block).toContain("FR")
    expect(block).toContain("203.0.113.42")
    expect(block).toContain("45.75")
    expect(block).toContain("4.85")
    expect(block).not.toMatch(/local \/ inconnue/)
  })

  test("le fuseau visiteur l'emporte s'il est valide", () => {
    const noonNy = Date.parse("2026-09-04T12:00:00-04:00")
    const block = formatVisitorContextBlock(
      facts({ nowMs: noonNy, timeZone: "America/New_York" }),
    )
    expect(block).toContain("America/New_York")
    expect(block).not.toContain("Europe/Paris")
  })

  test("un fuseau inventé retombe sur Europe/Paris", () => {
    const block = formatVisitorContextBlock(facts({ timeZone: "Mars/Olympus" }))
    expect(block).toContain(DEFAULT_VISITOR_TIMEZONE)
    expect(block).not.toContain("Mars/Olympus")
  })

  test("site, page, visiteur et agenda seulement s'ils existent", () => {
    const empty = formatVisitorContextBlock(facts())
    expect(empty).toMatch(/Agenda principal lié : non/)
    expect(empty).not.toContain("Visiteur :")
    expect(empty).not.toContain("Page :")
    expect(empty).not.toContain("Site :")

    const full = formatVisitorContextBlock(
      facts({
        siteName: "Cabinet Dupont",
        pageUrl: "https://exemple.fr/tarifs",
        leadName: "Ada",
        leadEmail: "ada@example.com",
        calendarConnected: true,
      }),
    )
    expect(full).toContain("Site : Cabinet Dupont")
    expect(full).toContain("Langue : fr")
    expect(full).toContain("Page : https://exemple.fr/tarifs")
    expect(full).toContain("Visiteur : Ada (ada@example.com)")
    expect(full).toMatch(/Agenda principal lié : oui/)
  })

  test("le prénom générique Visiteur sans e-mail est omis", () => {
    const block = formatVisitorContextBlock(facts({ leadName: "Visiteur" }))
    expect(block).not.toContain("Visiteur :")
  })
})

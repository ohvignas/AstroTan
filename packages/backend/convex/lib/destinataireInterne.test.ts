import { describe, expect, test } from "vitest"
import {
  choisirDestinataireInterne,
  emailSurDomaineDeclare,
  estTldReserve,
  extraireAdresse,
} from "./destinataireInterne"

describe("extraireAdresse", () => {
  test("prend les deux formes que Resend accepte", () => {
    expect(extraireAdresse("contact@exemple.fr")).toBe("contact@exemple.fr")
    expect(extraireAdresse("Illith <contact@exemple.fr>")).toBe("contact@exemple.fr")
  })

  test("refuse une chaîne qui n'est pas une adresse", () => {
    expect(extraireAdresse("")).toBeNull()
    expect(extraireAdresse("pas une adresse")).toBeNull()
  })
})

describe("emailSurDomaineDeclare", () => {
  test("matche l'hôte nu et un sous-domaine", () => {
    expect(emailSurDomaineDeclare("contact@illith.com", "illith.com")).toBe(true)
    expect(emailSurDomaineDeclare("a@mail.illith.com", "illith.com")).toBe(true)
    expect(emailSurDomaineDeclare("owner@illith.test", "illith.com")).toBe(false)
  })
})

describe("estTldReserve", () => {
  test("repère les TLD que personne n'ouvre", () => {
    expect(estTldReserve("owner@illith.test")).toBe(true)
    expect(estTldReserve("contact@illith.com")).toBe(false)
  })
})

describe("choisirDestinataireInterne", () => {
  test("préfère un staff du domaine déclaré à un owner .test", () => {
    expect(
      choisirDestinataireInterne({
        owners: ["owner@illith.test"],
        staff: ["owner@illith.test", "contact@illith.com"],
        declaredDomain: "illith.com",
        emailFrom: "owner@illith.com",
      }),
    ).toBe("contact@illith.com")
  })

  test("sans staff sur le domaine, prend emailFrom s'il y est déjà", () => {
    expect(
      choisirDestinataireInterne({
        owners: ["owner@illith.test"],
        staff: ["owner@illith.test"],
        declaredDomain: "illith.com",
        emailFrom: "Illith <bonjour@illith.com>",
      }),
    ).toBe("bonjour@illith.com")
  })

  test("n'invente pas une adresse sur le domaine déclaré", () => {
    expect(
      choisirDestinataireInterne({
        owners: ["owner@illith.test"],
        staff: ["owner@illith.test"],
        declaredDomain: "illith.com",
        emailFrom: null,
      }),
    ).toBe("owner@illith.test")
  })

  test("sans domaine déclaré, préfère un staff hors TLD réservé", () => {
    expect(
      choisirDestinataireInterne({
        owners: ["owner@illith.test"],
        staff: ["owner@illith.test", "contact@illith.com"],
        declaredDomain: null,
        emailFrom: "owner@illith.com",
      }),
    ).toBe("contact@illith.com")
  })
})

import { describe, expect, test } from "vitest"
import { domaineInitial, estEnvironnementLocal, valeurLocalePour } from "./domaineLocal"

describe("valeurLocalePour", () => {
  test("le site et l'admin ont chacun leur port documenté", () => {
    expect(valeurLocalePour("site")).toBe("localhost:4321")
    expect(valeurLocalePour("admin")).toBe("localhost:3001")
    expect(valeurLocalePour("umami")).toBe("localhost:4321")
  })
})

describe("estEnvironnementLocal", () => {
  test("vitest (DEV) est un environnement local", () => {
    expect(estEnvironnementLocal()).toBe(true)
  })
})

describe("domaineInitial", () => {
  test("le domaine déclaré l'emporte sur l'origine de repli", () => {
    expect(domaineInitial("declare.fr", "https://repli.fr")).toBe("declare.fr")
  })

  test("sans déclaration, l'hôte public de webUrl préremplit le champ", () => {
    expect(domaineInitial(null, "https://astrotan.illith.com")).toBe("astrotan.illith.com")
    expect(domaineInitial("  ", "https://astrotan.illith.com/")).toBe("astrotan.illith.com")
  })

  test("un repli local ou absent laisse le champ vide", () => {
    expect(domaineInitial(null, "http://localhost:4321")).toBe("")
    expect(domaineInitial(null, "http://127.0.0.1:4321")).toBe("")
    expect(domaineInitial(null, null)).toBe("")
    expect(domaineInitial(null, "pas-une-url")).toBe("")
  })
})

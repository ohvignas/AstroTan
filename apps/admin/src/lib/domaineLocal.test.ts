import { describe, expect, test } from "vitest"
import { estEnvironnementLocal, valeurLocalePour } from "./domaineLocal"

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

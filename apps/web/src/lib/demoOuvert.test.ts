import { describe, expect, test } from "vitest"
import { urlTester } from "./demoOuvert"

describe("urlTester", () => {
  test("ouvert false → null", () => {
    expect(urlTester(false, "https://admin.exemple.fr")).toBeNull()
  })

  test("ouvert true mais adminUrl null → null", () => {
    expect(urlTester(true, null)).toBeNull()
  })

  test("ouvert true + adminUrl → lien /demo-enter", () => {
    expect(urlTester(true, "https://admin.exemple.fr")).toBe(
      "https://admin.exemple.fr/demo-enter",
    )
  })

  test("barre oblique finale retirée de adminUrl", () => {
    expect(urlTester(true, "https://admin.exemple.fr/")).toBe(
      "https://admin.exemple.fr/demo-enter",
    )
  })
})

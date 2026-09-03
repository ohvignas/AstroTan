import { describe, expect, test } from "vitest"
import { canalOuvert, canalParDefaut } from "./notifier"

describe("canalParDefaut", () => {
  test("lead : cloche pour les trois rôles, e-mail owner/admin seulement", () => {
    expect(canalParDefaut("leadNotification", "cloche", "editor")).toBe(true)
    expect(canalParDefaut("leadNotification", "email", "owner")).toBe(true)
    expect(canalParDefaut("leadNotification", "email", "admin")).toBe(true)
    expect(canalParDefaut("leadNotification", "email", "editor")).toBe(false)
  })

  test("article : cloche pour les trois, e-mail jamais", () => {
    expect(canalParDefaut("postPublished", "cloche", "owner")).toBe(true)
    expect(canalParDefaut("postPublished", "email", "owner")).toBe(false)
    expect(canalParDefaut("postPublished", "email", "editor")).toBe(false)
  })
})

describe("canalOuvert", () => {
  test("sans ligne, le défaut gagne", () => {
    expect(canalOuvert(null, "leadNotification", "email", "editor")).toBe(false)
    expect(canalOuvert(null, "leadNotification", "cloche", "editor")).toBe(true)
  })

  test("une ligne écrite l'emporte", () => {
    expect(
      canalOuvert({ cloche: false, email: true }, "leadNotification", "email", "editor"),
    ).toBe(true)
    expect(
      canalOuvert({ cloche: false, email: true }, "leadNotification", "cloche", "owner"),
    ).toBe(false)
  })
})

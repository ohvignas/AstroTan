// L'entrée active de la barre latérale : « tu es ici ».
//
// `NavMain` s'appuie sur `<Link>` et `useRouterState` — même contrainte
// que `settings-nav.test.tsx`, on ne monte pas le routeur. Ce qui peut
// casser en silence, c'est la règle qui allume une entrée : `/` ne doit
// pas allumer tout le menu, `/settings` doit rester allumé sur
// `/settings/identite`.
import { describe, expect, test } from "vitest"
import { isSidebarPathActive } from "./nav-main"

const NAV_MAIN_SOURCE = import.meta.glob("./nav-main.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
})["./nav-main.tsx"] as string

describe("isSidebarPathActive", () => {
  test("la racine n'allume que le tableau de bord", () => {
    expect(isSidebarPathActive("/", "/")).toBe(true)
    expect(isSidebarPathActive("/pages", "/")).toBe(false)
    expect(isSidebarPathActive("/settings/identite", "/")).toBe(false)
  })

  test("une section allume ses pages filles", () => {
    expect(isSidebarPathActive("/settings", "/settings")).toBe(true)
    expect(isSidebarPathActive("/settings/identite", "/settings")).toBe(true)
    expect(isSidebarPathActive("/settings/identite/", "/settings")).toBe(true)
    expect(isSidebarPathActive("/pages/accueil", "/pages")).toBe(true)
    expect(isSidebarPathActive("/posts/abc", "/posts")).toBe(true)
  })

  test("une section n'allume pas une autre", () => {
    expect(isSidebarPathActive("/pages", "/settings")).toBe(false)
    expect(isSidebarPathActive("/media", "/pages")).toBe(false)
    expect(isSidebarPathActive("/settings-x", "/settings")).toBe(false)
  })
})

describe("NavMain — entrée courante", () => {
  test("passe isActive au bouton, via la règle de chemin", () => {
    expect(NAV_MAIN_SOURCE).toContain("isSidebarPathActive")
    expect(NAV_MAIN_SOURCE).toMatch(/isActive=\{/)
  })
})

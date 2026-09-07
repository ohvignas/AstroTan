import { describe, expect, test } from "vitest"
import source from "./index.tsx?raw"

function pagesListBody(): string {
  const start = source.indexOf("function PagesListPage")
  const end = source.indexOf("function PagesTable")
  return source.slice(start, end)
}

describe("ordre des hooks — React #310", () => {
  test("jeSuisDemo est lu avant le return de chargement de PagesListPage", () => {
    const body = pagesListBody()
    const hookAt = body.indexOf("useQuery(api.demo.jeSuisDemo)")
    const returnAt = body.indexOf("if (pages === undefined)")
    expect(hookAt).toBeGreaterThan(-1)
    expect(returnAt).toBeGreaterThan(-1)
    expect(hookAt).toBeLessThan(returnAt)
  })
})

describe("écran Chargement", () => {
  test("n'attend que pages.list — homePageSlug ne gouverne pas le tableau", () => {
    const body = pagesListBody()
    expect(body).toMatch(/if \(pages === undefined\)/)
    expect(body).not.toMatch(/homePageSlug === undefined/)
    expect(body).not.toMatch(/profile === undefined/)
  })
})

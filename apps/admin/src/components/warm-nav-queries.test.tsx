import { describe, expect, test } from "vitest"
import shell from "./app-shell.tsx?raw"
import source from "./warm-nav-queries.tsx?raw"

describe("listes tenues au chaud", () => {
  test("s'abonne à posts.list, pages.list et homePageSlug", () => {
    expect(source).toMatch(/useQuery\(api\.posts\.list\)/)
    expect(source).toMatch(/useQuery\(api\.pages\.list\)/)
    expect(source).toMatch(/useQuery\(api\.settings\.homePageSlug\)/)
  })

  test("AppShell monte WarmNavQueries sous Authenticated", () => {
    expect(shell).toMatch(/from ["']@\/components\/warm-nav-queries["']/)
    expect(shell).toMatch(/<WarmNavQueries\s*\/>/)
  })
})

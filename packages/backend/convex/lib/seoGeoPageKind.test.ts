import { expect, test } from "vitest"
import { classifyPageKind } from "./seoGeoPageKind"

test("un article est toujours article, quel que soit le slug", () => {
  expect(classifyPageKind({ kind: "post", slug: "accueil", title: "Accueil" })).toBe(
    "article",
  )
})

test("classe les pages vitrine par slug, titre, et page d'accueil", () => {
  expect(classifyPageKind({ kind: "page", slug: "accueil", title: "Bienvenue" })).toBe(
    "home",
  )
  expect(
    classifyPageKind(
      { kind: "page", slug: "maison", title: "Maison" },
      "maison",
    ),
  ).toBe("home")
  expect(classifyPageKind({ kind: "page", slug: "contact", title: "Écrire" })).toBe(
    "contact",
  )
  expect(
    classifyPageKind({ kind: "page", slug: "mentions-legales", title: "Mentions" }),
  ).toBe("legal")
  expect(
    classifyPageKind({ kind: "page", slug: "confidentialite", title: "Vie privée" }),
  ).toBe("legal")
  expect(classifyPageKind({ kind: "page", slug: "tarifs", title: "Prix" })).toBe(
    "service",
  )
  expect(classifyPageKind({ kind: "page", slug: "blog", title: "Journal" })).toBe(
    "blog_index",
  )
  expect(classifyPageKind({ kind: "page", slug: "a-propos", title: "L'équipe" })).toBe(
    "generic",
  )
})

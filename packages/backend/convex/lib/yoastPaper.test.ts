import { describe, expect, test } from "vitest"
import { paperAttributes, postPermalink } from "./yoastPaper"

describe("postPermalink", () => {
  test("origine Convex + /blog/slug, sans slash double", () => {
    expect(postPermalink("https://exemple.fr/", "bonjour")).toBe(
      "https://exemple.fr/blog/bonjour",
    )
  })

  test("sans origine : pas d'URL inventée", () => {
    expect(postPermalink(undefined, "bonjour")).toBe("")
    expect(postPermalink("", "bonjour")).toBe("")
  })
})

describe("paperAttributes", () => {
  test("H1 public = title, titre SEO = seoTitle, locale fr_FR", () => {
    const attrs = paperAttributes({
      title: "Le vrai H1",
      seoTitle: "Titre SERP",
      seoDescription: "Meta.",
      targetKeyword: "astro",
      slug: "le-vrai-h1",
      webOrigin: "https://exemple.fr",
    })
    expect(attrs.textTitle).toBe("Le vrai H1")
    expect(attrs.title).toBe("Titre SERP")
    expect(attrs.description).toBe("Meta.")
    expect(attrs.keyword).toBe("astro")
    expect(attrs.slug).toBe("le-vrai-h1")
    expect(attrs.locale).toBe("fr_FR")
    expect(attrs.permalink).toBe("https://exemple.fr/blog/le-vrai-h1")
  })

  test("sans titre SEO, Paper.title retombe sur le H1", () => {
    const attrs = paperAttributes({
      title: "H1 seul",
      seoTitle: "  ",
      seoDescription: "",
      targetKeyword: "",
      slug: "h1-seul",
      webOrigin: undefined,
    })
    expect(attrs.title).toBe("H1 seul")
    expect(attrs.textTitle).toBe("H1 seul")
    expect(attrs.permalink).toBe("")
  })
})

import { describe, expect, test } from "vitest"
import {
  articleJsonLd,
  breadcrumbJsonLd,
  faqJsonLd,
  organizationJsonLd,
  serializeJsonLd,
} from "./jsonLd"

const SITE = { siteName: "Exemple", logoUrl: "https://exemple.fr/logo.png", socials: [] }

// ---------------------------------------------------------------------
// L'injection, en premier
// ---------------------------------------------------------------------

describe("sérialisation", () => {
  test("un titre contenant </script> ne peut pas fermer la balise", () => {
    // `JSON.stringify` brut dans un `<script>` est une injection : le
    // navigateur cherche la chaîne `</script>` sans se soucier du JSON qui
    // l'entoure, et tout ce qui suit devient du balisage exécutable.
    const serialized = serializeJsonLd({ name: "</script><img onerror=alert(1)>" })
    expect(serialized).not.toContain("</script>")
    expect(serialized).not.toContain("<img")
  })

  test("les chevrons et l'esperluette sortent échappés", () => {
    const serialized = serializeJsonLd({ name: "Tom & <Jerry>" })
    expect(serialized).not.toMatch(/[<>]/)
    expect(JSON.parse(serialized.replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&")).name)
      .toBe("Tom & <Jerry>")
  })

  test("le résultat reste du JSON valide", () => {
    expect(() => JSON.parse(serializeJsonLd({ a: 1, b: "deux" }))).not.toThrow()
  })
})

// ---------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------

describe("organizationJsonLd", () => {
  test("porte le nom, le logo et les réseaux en sameAs", () => {
    const ld = organizationJsonLd(
      { ...SITE, socials: [{ label: "LinkedIn", url: "https://linkedin.com/company/exemple" }] },
      "https://exemple.fr",
    )
    expect(ld["@type"]).toBe("Organization")
    expect(ld!.name).toBe("Exemple")
    expect(ld!.logo).toBe("https://exemple.fr/logo.png")
    expect(ld!.sameAs).toEqual(["https://linkedin.com/company/exemple"])
  })

  test("omet les champs absents plutôt que de les rendre vides", () => {
    // Un `logo: ""` est pire qu'un logo absent : un consommateur le lit
    // comme une URL et échoue dessus.
    const ld = organizationJsonLd({ siteName: "Exemple", logoUrl: null, socials: [] }, "https://exemple.fr")
    expect("logo" in ld).toBe(false)
    expect("sameAs" in ld).toBe(false)
  })
})

// ---------------------------------------------------------------------
// Article
// ---------------------------------------------------------------------

describe("articleJsonLd", () => {
  const post = {
    title: "Bienvenue",
    slug: "bienvenue",
    excerpt: "Un résumé.",
    publishedAt: 1_700_000_000_000,
    coverUrl: "https://exemple.fr/couv.jpg",
  }

  test("porte le titre, les dates et l'image", () => {
    const ld = articleJsonLd(post, SITE, "https://exemple.fr/blog/bienvenue")
    expect(ld!["@type"]).toBe("Article")
    expect(ld!.headline).toBe("Bienvenue")
    expect(ld!.datePublished).toBe(new Date(post.publishedAt).toISOString())
    expect(ld!.image).toBe(post.coverUrl)
    expect((ld!.publisher as { name: string }).name).toBe("Exemple")
  })

  test("n'invente pas de date pour un article sans publishedAt", () => {
    // `datePublished` est obligatoire dans le vocabulaire : mieux vaut ne
    // pas émettre l'objet que d'y mettre une date fabriquée.
    const ld = articleJsonLd({ ...post, publishedAt: undefined }, SITE, "https://x/y")
    expect(ld).toBeNull()
  })
})

// ---------------------------------------------------------------------
// FAQPage — la raison d'être du champ geo.faq
// ---------------------------------------------------------------------

describe("faqJsonLd", () => {
  test("transforme les paires question/réponse en FAQPage", () => {
    const ld = faqJsonLd([
      { question: "Combien ça coûte ?", answer: "C'est gratuit." },
      { question: "Où ?", answer: "En ligne." },
    ])
    expect(ld?.["@type"]).toBe("FAQPage")
    expect(ld?.mainEntity).toHaveLength(2)
    expect(ld?.mainEntity[0]).toMatchObject({
      "@type": "Question",
      name: "Combien ça coûte ?",
      acceptedAnswer: { "@type": "Answer", text: "C'est gratuit." },
    })
  })

  test("rend null plutôt qu'un FAQPage vide", () => {
    expect(faqJsonLd([])).toBeNull()
    expect(faqJsonLd(undefined)).toBeNull()
  })

  test("ignore une paire incomplète", () => {
    // Une question sans réponse produit un `Question` sans `acceptedAnswer`,
    // que les validateurs refusent — et qui invaliderait tout le bloc.
    const ld = faqJsonLd([
      { question: "Complète ?", answer: "Oui." },
      { question: "Sans réponse", answer: "  " },
    ])
    expect(ld?.mainEntity).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------
// Fil d'Ariane
// ---------------------------------------------------------------------

describe("breadcrumbJsonLd", () => {
  test("numérote les positions à partir de 1", () => {
    const ld = breadcrumbJsonLd(
      [
        { name: "Accueil", url: "https://exemple.fr/" },
        { name: "Blog", url: "https://exemple.fr/blog" },
        { name: "Bienvenue", url: "https://exemple.fr/blog/bienvenue" },
      ],
    )
    expect(ld?.itemListElement.map((i) => i.position)).toEqual([1, 2, 3])
    expect(ld?.itemListElement[2]).toMatchObject({ name: "Bienvenue" })
  })
})

import { DOMParser } from "@xmldom/xmldom"
import { describe, expect, test } from "vitest"
import { buildLlmsTxt, buildSitemap } from "./feeds"

const ORIGIN = "https://illith.com"

const PAGE = {
  slug: "contact",
  title: "Contact",
  publishedAt: 1_700_000_000_000,
  seo: undefined as { noindex?: boolean; description?: string } | undefined,
  geo: undefined as { summary?: string; noai?: boolean } | undefined,
}

const POST = {
  slug: "bienvenue",
  title: "Bienvenue",
  excerpt: "Un résumé.",
  publishedAt: 1_700_000_000_000,
  seo: undefined as { noindex?: boolean; description?: string } | undefined,
  geo: undefined as { summary?: string; noai?: boolean } | undefined,
}

// ---------------------------------------------------------------------
// L'échappement XML, en premier
// ---------------------------------------------------------------------

describe("buildSitemap — échappement", () => {
  test("une esperluette dans un slug ne casse pas le XML", () => {
    // Concaténer des chaînes produit un XML invalide au premier `&` : le
    // parseur s'arrête là, et le sitemap entier devient illisible.
    const xml = buildSitemap({
      origin: ORIGIN,
      pages: [{ ...PAGE, slug: "a&b" }],
      posts: [],
      servedPaths: ["/a&b"],
    })
    expect(xml).toContain("&amp;")
    expect(xml).not.toMatch(/<loc>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/)
  })

  test("le résultat est du XML analysable par un vrai parseur", () => {
    const xml = buildSitemap({
      origin: ORIGIN,
      pages: [PAGE],
      posts: [POST],
      servedPaths: ["/contact"],
    })

    // Un parseur réel, pas une inspection visuelle : c'est la seule façon
    // de savoir qu'un moteur lira ce fichier plutôt que de s'arrêter dessus.
    const erreurs: string[] = []
    const doc = new DOMParser({
      onError: (level, message) => {
        if (level !== "warning") erreurs.push(message)
      },
    }).parseFromString(xml, "text/xml")

    expect(erreurs).toEqual([])
    expect(doc.getElementsByTagName("url").length).toBe(2)
  })

  test("un slug avec une esperluette reste analysable", () => {
    // Le cas exact qui casse un XML concaténé à la main.
    const xml = buildSitemap({
      origin: ORIGIN,
      pages: [{ ...PAGE, slug: "offre&promo" }],
      posts: [],
      servedPaths: ["/offre&promo"],
    })
    const erreurs: string[] = []
    const doc = new DOMParser({
      onError: (level, message) => {
        if (level !== "warning") erreurs.push(message)
      },
    }).parseFromString(xml, "text/xml")

    expect(erreurs).toEqual([])
    expect(doc.getElementsByTagName("loc")[0]?.textContent).toBe(
      "https://illith.com/offre&promo",
    )
  })
})

// ---------------------------------------------------------------------
// L'invariant : rien de non publié n'y figure
// ---------------------------------------------------------------------

describe("buildSitemap — ce qui n'y figure pas", () => {
  test("une page publiée sans fichier de route est exclue", () => {
    // Elle rend 404 : l'inscrire au sitemap serait dire à un moteur d'aller
    // chercher une page qui n'existe pas.
    const xml = buildSitemap({
      origin: ORIGIN,
      pages: [{ ...PAGE, slug: "fantome" }],
      posts: [],
      servedPaths: ["/contact"],
    })
    expect(xml).not.toContain("fantome")
  })

  test("une page en noindex est exclue", () => {
    // La lister tout en demandant sa désindexation est contradictoire.
    const xml = buildSitemap({
      origin: ORIGIN,
      pages: [{ ...PAGE, seo: { noindex: true } }],
      posts: [],
      servedPaths: ["/contact"],
    })
    expect(xml).not.toContain("contact")
  })

  test("lastmod vient de publishedAt", () => {
    const xml = buildSitemap({
      origin: ORIGIN,
      pages: [PAGE],
      posts: [],
      servedPaths: ["/contact"],
    })
    expect(xml).toContain(`<lastmod>${new Date(PAGE.publishedAt).toISOString()}</lastmod>`)
  })

  test("les articles sont préfixés par /blog", () => {
    const xml = buildSitemap({ origin: ORIGIN, pages: [], posts: [POST], servedPaths: [] })
    expect(xml).toContain(`${ORIGIN}/blog/bienvenue`)
  })
})

// ---------------------------------------------------------------------
// llms.txt
// ---------------------------------------------------------------------

describe("buildLlmsTxt", () => {
  test("liste le site, ses pages et ses articles avec leur résumé", () => {
    const txt = buildLlmsTxt({
      origin: ORIGIN,
      siteName: "Illith",
      pages: [{ ...PAGE, geo: { summary: "Comment nous joindre." } }],
      posts: [POST],
      servedPaths: ["/contact"],
    })
    expect(txt).toContain("# Illith")
    expect(txt).toContain("Comment nous joindre.")
    // À défaut de résumé GEO, l'extrait de l'article fait l'affaire.
    expect(txt).toContain("Un résumé.")
    expect(txt).toContain(`${ORIGIN}/blog/bienvenue`)
  })

  test("exclut tout contenu portant noai", () => {
    // C'est la moitié GEO de l'invariant : un extrait conçu pour être cité,
    // sur un contenu dont l'opérateur a demandé qu'il ne le soit pas.
    const txt = buildLlmsTxt({
      origin: ORIGIN,
      siteName: "Illith",
      pages: [{ ...PAGE, geo: { summary: "Secret.", noai: true } }],
      posts: [{ ...POST, geo: { noai: true } }],
      servedPaths: ["/contact"],
    })
    expect(txt).not.toContain("Secret.")
    expect(txt).not.toContain("bienvenue")
  })

  test("exclut une page publiée sans fichier de route", () => {
    const txt = buildLlmsTxt({
      origin: ORIGIN,
      siteName: "Illith",
      pages: [{ ...PAGE, slug: "fantome" }],
      posts: [],
      servedPaths: ["/contact"],
    })
    expect(txt).not.toContain("fantome")
  })
})

describe("la page d'accueil, dont le slug et le chemin diffèrent", () => {
  test("elle figure au sitemap à la racine, pas sous son slug", () => {
    // Son slug est `accueil`, elle répond à `/`. Sans traitement, l'URL la
    // plus importante du site était absente des deux fichiers — constaté
    // sur la première sortie réelle.
    const xml = buildSitemap({
      origin: ORIGIN,
      pages: [{ ...PAGE, slug: "accueil" }],
      posts: [],
      servedPaths: ["/"],
      homePageSlug: "accueil",
    })
    expect(xml).toContain(`<loc>${ORIGIN}</loc>`)
    expect(xml).not.toContain("/accueil")
  })

  test("et dans llms.txt à la racine également", () => {
    const txt = buildLlmsTxt({
      origin: ORIGIN,
      siteName: "Illith",
      pages: [{ ...PAGE, slug: "accueil" }],
      posts: [],
      servedPaths: ["/"],
      homePageSlug: "accueil",
    })
    expect(txt).toContain(`(${ORIGIN})`)
  })
})

describe("l'index du blog", () => {
  test("est listé quand il a des articles à lister", () => {
    const xml = buildSitemap({
      origin: ORIGIN,
      pages: [],
      posts: [POST],
      servedPaths: ["/blog"],
    })
    expect(xml).toContain(`<loc>${ORIGIN}/blog</loc>`)
  })

  test("ne l'est pas quand le blog est vide", () => {
    // Annoncer une page de liste vide à un moteur n'apporte rien.
    const xml = buildSitemap({ origin: ORIGIN, pages: [], posts: [], servedPaths: ["/blog"] })
    expect(xml).not.toContain("/blog")
  })
})

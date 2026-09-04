import { describe, expect, test } from "vitest"
import {
  MAX_GEO_ANSWER_LENGTH,
  MAX_GEO_ENTITIES,
  MAX_GEO_FAQ_ITEMS,
  MAX_GEO_SUMMARY_LENGTH,
  MAX_SEO_DESCRIPTION_LENGTH,
  MAX_SEO_TITLE_LENGTH,
} from "../content"
import {
  draftFromModel,
  isEmptyDraft,
  sourcePayload,
} from "./seoGeoDraft"

describe("sourcePayload", () => {
  test("une page n'envoie ni corps ni extrait — la base n'en a pas", () => {
    const payload = sourcePayload({
      kind: "page",
      title: "Accueil",
      slug: "accueil",
      publicUrl: "https://exemple.fr/",
      seo: { title: "Titre actuel" },
      geo: { summary: "Résumé actuel" },
      siteName: "Exemple",
    })
    expect(payload).not.toHaveProperty("body")
    expect(payload).not.toHaveProperty("excerpt")
    expect(payload.kind).toBe("page")
    expect(payload.title).toBe("Accueil")
  })

  test("un article envoie l'extrait et le corps déjà en base", () => {
    const payload = sourcePayload({
      kind: "post",
      title: "Un billet",
      slug: "un-billet",
      excerpt: "L'attaque.",
      body: "<p>Le développement.</p>",
      targetKeyword: "agence web",
    })
    expect(payload.excerpt).toBe("L'attaque.")
    expect(payload.body).toBe("<p>Le développement.</p>")
    expect(payload.targetKeyword).toBe("agence web")
  })
})

describe("draftFromModel", () => {
  test("borne chaque champ texte aux constantes du schéma", () => {
    const draft = draftFromModel(
      {
        seoTitle: "T".repeat(MAX_SEO_TITLE_LENGTH + 20),
        seoDescription: "D".repeat(MAX_SEO_DESCRIPTION_LENGTH + 20),
        geoSummary: "S".repeat(MAX_GEO_SUMMARY_LENGTH + 20),
        geoFaq: [
          {
            question: "Q".repeat(300),
            answer: "A".repeat(MAX_GEO_ANSWER_LENGTH + 10),
          },
        ],
        geoEntities: ["E".repeat(200), "AstroTan"],
        geoNoai: true,
      },
      false,
    )
    expect(draft.seo.title).toHaveLength(MAX_SEO_TITLE_LENGTH)
    expect(draft.seo.description).toHaveLength(MAX_SEO_DESCRIPTION_LENGTH)
    expect(draft.geo.summary).toHaveLength(MAX_GEO_SUMMARY_LENGTH)
    expect(draft.geo.faq).toHaveLength(1)
    expect(draft.geo.entities[0]?.length).toBeLessThanOrEqual(100)
    expect(draft.geo.noai).toBe(true)
  })

  test("n'invente pas de champ SEO hors title/description", () => {
    const draft = draftFromModel(
      {
        seoTitle: "Titre",
        seoDescription: "Desc",
        geoSummary: "Résumé",
        noindex: true,
        canonicalUrl: "https://evil.example",
        ogImageId: "kg123",
        robots: { noindex: true },
      },
      false,
    )
    expect(draft.seo).toEqual({ title: "Titre", description: "Desc" })
    expect(draft).not.toHaveProperty("robots")
    expect(draft.geo.noai).toBe(false)
  })

  test("garde le noai existant si le modèle ne rend pas un booléen", () => {
    const draft = draftFromModel(
      { seoTitle: "T", seoDescription: "D", geoSummary: "S" },
      true,
    )
    expect(draft.geo.noai).toBe(true)
  })

  test("tronque faq et entités aux plafonds du schéma", () => {
    const draft = draftFromModel(
      {
        seoTitle: "T",
        seoDescription: "D",
        geoSummary: "S",
        geoFaq: Array.from({ length: MAX_GEO_FAQ_ITEMS + 5 }, (_, i) => ({
          question: `Q${i}`,
          answer: `A${i}`,
        })),
        geoEntities: Array.from({ length: MAX_GEO_ENTITIES + 5 }, (_, i) => `E${i}`),
      },
      false,
    )
    expect(draft.geo.faq).toHaveLength(MAX_GEO_FAQ_ITEMS)
    expect(draft.geo.entities).toHaveLength(MAX_GEO_ENTITIES)
  })

  test("jette une FAQ incomplète plutôt que d'émettre une paire vide", () => {
    const draft = draftFromModel(
      {
        seoTitle: "T",
        seoDescription: "D",
        geoSummary: "S",
        geoFaq: [{ question: "  ", answer: "oui" }, { question: "Quoi ?", answer: "Ça." }],
      },
      false,
    )
    expect(draft.geo.faq).toEqual([{ question: "Quoi ?", answer: "Ça." }])
  })

  test("accepte le JSON imbriqué { seo, geo } que les flagships renvoient", () => {
    const draft = draftFromModel(
      {
        seo: { title: "Titre imbriqué", description: "Desc imbriquée." },
        geo: {
          summary: "Résumé imbriqué.",
          faq: [{ question: "Q ?", answer: "R." }],
          entities: ["Lyon"],
          noai: false,
        },
        excerpt: "Chapô généré.",
      },
      true,
    )
    expect(draft.seo.title).toBe("Titre imbriqué")
    expect(draft.seo.description).toBe("Desc imbriquée.")
    expect(draft.geo.summary).toBe("Résumé imbriqué.")
    expect(draft.geo.faq).toEqual([{ question: "Q ?", answer: "R." }])
    expect(draft.geo.entities).toEqual(["Lyon"])
    expect(draft.geo.noai).toBe(false)
    expect(draft.excerpt).toBe("Chapô généré.")
    expect(isEmptyDraft(draft)).toBe(false)
  })

  test("un JSON imbriqué vide est un brouillon vide — plus une « réponse inutilisable » silencieuse", () => {
    expect(isEmptyDraft(draftFromModel({ seo: {}, geo: {} }, false))).toBe(true)
  })
})

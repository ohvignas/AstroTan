import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { SeoPixelPage, estDataForSeoConfigure } from "./settings-seo-pixel"

const blocVide = {
  cleMaitresse: "posee" as const,
  etats: {},
  canWrite: true,
  onSave: async () => {},
  onClear: async () => {},
}

const inerte = {
  canWrite: true,
  secrets: blocVide,
  dataForSeo: { login: null as string | null, passwordPose: false },
  metaPixelId: null as string | null,
  googleTagId: null as string | null,
  googleConversionLabel: null as string | null,
  serpLocationCode: null as number | null,
  serpLanguageCode: null as string | null,
  onSaveDataForSeo: async () => ({ verdict: "valide" as const }),
  onClearSecret: async () => {},
  onSavePixel: async () => {},
  onSaveSerp: async () => {},
}

test("les trois lignes sont là, Umami n'y est plus", () => {
  const html = renderToStaticMarkup(<SeoPixelPage {...inerte} />)
  expect(html).toContain("DataForSEO")
  expect(html).toContain("Pixel Meta")
  expect(html).toContain("Google Ads")
  expect(html).toContain("France (Google)")
  expect(html).toContain("Belgique (Google)")
  expect(html).toContain("Paris (Google)")
  expect(html).toContain("Lieu SERP")
  expect(html).not.toContain("UMAMI_API")
  expect(html).not.toContain("PUBLIC_UMAMI")
  expect(html).not.toContain("PUBLIC_META_PIXEL_ID")
})

test("DataForSEO n'est configuré que si les deux secrets ont une source", () => {
  expect(estDataForSeoConfigure({
    DATAFORSEO_LOGIN: { source: "base" },
    DATAFORSEO_PASSWORD: { source: "aucune" },
  })).toBe(false)
  expect(estDataForSeoConfigure({
    DATAFORSEO_LOGIN: { source: "base" },
    DATAFORSEO_PASSWORD: { source: "environnement" },
  })).toBe(true)
})

test("posé, Connecté à côté d'Enregistrer — pas de pastille, pas configuré", () => {
  const html = renderToStaticMarkup(
    <SeoPixelPage
      {...inerte}
      secrets={{
        ...blocVide,
        etats: {
          DATAFORSEO_LOGIN: {
            nom: "DATAFORSEO_LOGIN",
            environnement: false,
            base: true,
            illisible: false,
            source: "base",
          },
          DATAFORSEO_PASSWORD: {
            nom: "DATAFORSEO_PASSWORD",
            environnement: false,
            base: true,
            illisible: false,
            source: "base",
          },
        },
      }}
      metaPixelId="123"
    />,
  )
  expect(html.split("Connecté").length - 1).toBe(2)
  expect(html).toContain("text-emerald-600")
  expect(html).not.toContain("configuré")
})

test("un editor voit l'ID et aucun bouton d'écriture", () => {
  const html = renderToStaticMarkup(
    <SeoPixelPage
      {...inerte}
      canWrite={false}
      secrets={{ cleMaitresse: null, etats: {}, canWrite: false, onSave: async () => {}, onClear: async () => {} }}
      metaPixelId="123"
    />,
  )
  expect(html).toMatch(/réservé/i)
  expect(html).toContain("123")
  expect(html).not.toContain("Enregistrer")
  expect(html).not.toContain("Supprimer")
  expect(html).not.toContain("Effacer")
})

test("login DataForSEO et pixels sont visibles sans déplier", () => {
  const html = renderToStaticMarkup(<SeoPixelPage {...inerte} />)
  expect(html).not.toMatch(/aria-expanded/)
  expect(html).toContain("DATAFORSEO_LOGIN")
  expect(html).toContain("DATAFORSEO_PASSWORD")
  expect(html).toContain("pixel-meta")
  expect(html).toContain("pixel-google")
  expect(html).toContain("pixel-label")
  expect(html).toContain("Label de conversion Ads")
})

test("DataForSEO a un seul Enregistrer, pas de Vérifier ni de Retirer", () => {
  const html = renderToStaticMarkup(<SeoPixelPage {...inerte} />)
  expect(html).not.toContain("Vérifier et enregistrer")
  expect(html).not.toContain("Retirer")
  expect(html).toContain("Enregistrer")
})

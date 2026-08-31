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

const serp = {
  serpLocationCode: null as number | null,
  serpLanguageCode: null as string | null,
  onSaveSerp: async () => {},
}

test("les trois lignes sont là, Umami n'y est plus", () => {
  const html = renderToStaticMarkup(
    <SeoPixelPage
      canWrite
      secrets={blocVide}
      metaPixelId={null}
      googleTagId={null}
      onSaveSecret={async () => {}}
      onClearSecret={async () => {}}
      onSavePixel={async () => {}}
      {...serp}
    />,
  )
  expect(html).toContain("DataForSEO")
  expect(html).toContain("Pixel Meta")
  expect(html).toContain("Google Ads")
  expect(html).toContain("France (Google)")
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

test("un editor voit l'ID et aucun bouton d'écriture", () => {
  const html = renderToStaticMarkup(
    <SeoPixelPage
      canWrite={false}
      secrets={{ cleMaitresse: null, etats: {}, canWrite: false, onSave: async () => {}, onClear: async () => {} }}
      metaPixelId="123"
      googleTagId={null}
      onSaveSecret={async () => {}}
      onClearSecret={async () => {}}
      onSavePixel={async () => {}}
      {...serp}
    />,
  )
  expect(html).toMatch(/réservé/i)
  expect(html).toContain("123")
  expect(html).not.toContain("Enregistrer")
  expect(html).not.toContain("Supprimer")
})

test("settings-seo-pixel réutilise actionSurLigne, il ne le recopie pas", async () => {
  const { readFileSync } = await import("node:fs")
  const src = readFileSync(new URL("./settings-seo-pixel.tsx", import.meta.url), "utf8")
  expect(src).toContain("actionSurLigne")
  expect(src).toMatch(/email-templates/)
})

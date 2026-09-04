/**
 * Paramètres Image API pour une une d'article.
 *
 * Relevés le 2026-09-01 sur les endpoints OpenRouter des trois modèles
 * Gemini du sélecteur :
 *   - `aspect_ratio` : 16:9 partout
 *   - `resolution` : 1K/2K (Pro), 512/1K/2K/4K (3.1 Flash) — absent de 2.5 Flash
 *   - `output_format` / `size` / `output_compression` : absents — les envoyer
 *     n'est pas un contrôle, c'est un paramètre ignoré (ou un 400)
 *
 * 1K 16:9 chez Nano Banana Pro ≈ 1376×768. 2K serait 2752×1536 : trop large
 * pour une une + og:image, et Gemini ne sait pas sortir du WebP.
 */
export const COVER_ASPECT_RATIO = "16:9" as const
export const COVER_RESOLUTION = "1K" as const

const MODELS_AVEC_RESOLUTION = new Set([
  "google/gemini-3-pro-image",
  "google/gemini-3.1-flash-image",
])

export function coverGenerationParams(model: string): {
  aspect_ratio: typeof COVER_ASPECT_RATIO
  resolution?: typeof COVER_RESOLUTION
} {
  if (MODELS_AVEC_RESOLUTION.has(model)) {
    return { aspect_ratio: COVER_ASPECT_RATIO, resolution: COVER_RESOLUTION }
  }
  return { aspect_ratio: COVER_ASPECT_RATIO }
}

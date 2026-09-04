import type { ConsentEnv } from "./consent"

export type PixelSettings = {
  metaPixelId?: string | null
  googleTagId?: string | null
  googleConversionLabel?: string | null
}

/**
 * Un champ jamais saisi (`null` / `undefined`) retombe sur le `PUBLIC_*`
 * du build. Une chaîne vide est un retrait : le pixel disparaît, même si
 * le build en porte encore un.
 */
export function choisirIdentifiant(
  enBase: string | null | undefined,
  auBuild: string | undefined,
): string | undefined {
  if (enBase === "") return undefined
  if (enBase == null) {
    const trimmed = auBuild?.trim()
    return trimmed ? trimmed : undefined
  }
  return enBase
}

export function fusionnerPixels(
  settings: PixelSettings | null,
  env: ConsentEnv,
): ConsentEnv & { googleConversionLabel?: string } {
  return {
    ...env,
    PUBLIC_META_PIXEL_ID: choisirIdentifiant(settings?.metaPixelId, env.PUBLIC_META_PIXEL_ID),
    PUBLIC_GOOGLE_TAG_ID: choisirIdentifiant(settings?.googleTagId, env.PUBLIC_GOOGLE_TAG_ID),
    // Pas de fallback PUBLIC_* : le label n'existe que saisi ici.
    googleConversionLabel: choisirIdentifiant(settings?.googleConversionLabel, undefined),
  }
}

import type { ConsentEnv } from "./consent"

/**
 * L'environnement effectif du script du bandeau : Umami vient du build,
 * les pixels viennent uniquement des `data-*` posés au rendu.
 *
 * Un attribut vide n'est pas un oubli — c'est un retrait. Retomber sur le
 * `PUBLIC_*` du build ferait réapparaître un pixel qu'on a volontairement
 * éteint depuis l'administration.
 */
export function envDepuisBandeau(
  dataset: { metaPixelId?: string; googleTagId?: string },
  build: ConsentEnv,
): ConsentEnv {
  return {
    ...build,
    PUBLIC_META_PIXEL_ID: dataset.metaPixelId || undefined,
    PUBLIC_GOOGLE_TAG_ID: dataset.googleTagId || undefined,
  }
}

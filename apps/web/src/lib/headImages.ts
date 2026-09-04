import { getImage } from "astro:assets"

/** 1200×675 = 16:9, voisin du 1200×630 (1.91:1) recommandé pour og:image. */
export const OG_SHARE_WIDTH = 1200
export const OG_SHARE_HEIGHT = 675

function entierPositif(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function urlAbsolue(src: string, origin: string): string {
  return new URL(src, origin).href
}

/** `og:image:alt` : légende média si elle existe, sinon le titre de page. */
export function texteAltPartage(
  caption: { alt?: string } | null | undefined,
  fallback: string,
): string {
  const alt = caption?.alt?.trim()
  return alt && alt.length > 0 ? alt : fallback
}

export type ShareImageChoice =
  | { kind: "cover"; url: string }
  | { kind: "storage"; storageId: string }

/**
 * Image de partage : couverture d'abord (articles), puis `seo.ogImageId`
 * encore en base, puis le défaut du site. Les pages n'ont en général pas
 * de couverture — elles tombent sur ogImageId / défaut sans rien fusionner.
 */
export function resolveShareImage(input: {
  coverUrl?: string | null
  ogImageId?: string | null
  defaultOgImageId?: string | null
}): ShareImageChoice | null {
  const cover = input.coverUrl?.trim()
  if (cover) return { kind: "cover", url: cover }
  if (input.ogImageId) return { kind: "storage", storageId: input.ogImageId }
  if (input.defaultOgImageId) {
    return { kind: "storage", storageId: input.defaultOgImageId }
  }
  return null
}

/** Favicon / apple-touch : proxifiés pour tomber sous `'self'` (CSP `img-src`). */
export async function proxifierFavicon(url: string, size: number): Promise<string> {
  try {
    return (await getImage({ src: url, width: size, height: size, format: "png" })).src
  } catch {
    return url
  }
}

/**
 * og:image / twitter:image.
 *
 * Les crawlers ne passent pas par `<Image>` : sans ce proxy ils téléchargent
 * le PNG Convex brut. `getImage` sort un JPEG 1200 via `/_image`, sur notre
 * origine. Si le domaine n'est pas dans `remotePatterns`, on garde l'URL
 * brute plutôt qu'une balise vide.
 */
export async function proxifierPartage(
  url: string,
  origin: string,
): Promise<{ href: string; width?: number; height?: number }> {
  try {
    const image = await getImage({
      src: url,
      width: OG_SHARE_WIDTH,
      height: OG_SHARE_HEIGHT,
      format: "jpg",
    })
    return {
      href: urlAbsolue(image.src, origin),
      width: entierPositif(image.attributes.width),
      height: entierPositif(image.attributes.height),
    }
  } catch {
    return { href: url }
  }
}

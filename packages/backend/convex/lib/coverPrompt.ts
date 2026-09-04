import { clip } from "./seoGeoDraft"
import type { SeoPageKind } from "./seoGeoPageKind"

const MAX_COVER_PROMPT = 1_200

const PAGE_KIND_LABEL: Record<SeoPageKind, string> = {
  home: "accueil",
  contact: "contact",
  legal: "mentions légales",
  service: "offre / services",
  blog_index: "index du blog",
  article: "article",
  generic: "page vitrine",
}

const STYLE = [
  `Style : photo réelle, lumière naturelle, composition 16:9, calme, professionnelle.`,
  `Aucun texte, logo, filigrane, typographie ou signature dans l'image.`,
  `Pas d'illustration cartoon, pas de collage, pas de visages reconnaissables inventés.`,
]

export function coverPrompt(input: {
  title: string
  excerpt?: string
  targetKeyword?: string
  siteName?: string
}): string {
  const bits = [
    `Photographie éditoriale pour la une d'un article de site vitrine.`,
    `Sujet : ${input.title}.`,
    input.excerpt ? `Chapô : ${clip(input.excerpt, 220)}.` : null,
    input.targetKeyword ? `Thème : ${input.targetKeyword}.` : null,
    input.siteName ? `Marque (ne pas l'écrire dans l'image) : ${input.siteName}.` : null,
    ...STYLE,
  ]
  return clip(bits.filter(Boolean).join(" "), MAX_COVER_PROMPT)
}

export function pageOgPrompt(input: {
  title: string
  slug: string
  pageKind: SeoPageKind
  targetKeyword?: string
  siteName?: string
}): string {
  const bits = [
    `Photographie éditoriale pour l'image de partage d'une page de site vitrine.`,
    `Sujet : ${input.title}.`,
    `Slug : ${input.slug}.`,
    `Type de page : ${PAGE_KIND_LABEL[input.pageKind]}.`,
    input.targetKeyword ? `Thème : ${input.targetKeyword}.` : null,
    input.siteName ? `Marque (ne pas l'écrire dans l'image) : ${input.siteName}.` : null,
    ...STYLE,
  ]
  return clip(bits.filter(Boolean).join(" "), MAX_COVER_PROMPT)
}

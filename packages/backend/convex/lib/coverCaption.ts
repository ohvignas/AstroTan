import { clip } from "./seoGeoDraft"

export const MAX_COVER_ALT_LENGTH = 125
export const MAX_COVER_TITLE_LENGTH = 70

const IMAGE_DE_RE = /\b(?:image|photo|illustration|visuel)\s+(?:de|d'|d’|du|des)\s+/gi
const SIRET_LABEL_RE = /\b(?:SIRET|SIREN)\s*:?\s*[\d\s.]{6,}\b/gi
const SIRET_DIGITS_RE = /\b\d{3}\s?\d{3}\s?\d{3}\s?\d{5}\b/g

function countPhrase(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  const lower = haystack.toLowerCase()
  const target = needle.toLowerCase()
  let count = 0
  let from = 0
  while (from < lower.length) {
    const index = lower.indexOf(target, from)
    if (index === -1) break
    count += 1
    from = index + target.length
  }
  return count
}

export function sanitizeCoverCaptionText(value: string): string {
  return value
    .replace(SIRET_LABEL_RE, "")
    .replace(SIRET_DIGITS_RE, "")
    .replace(IMAGE_DE_RE, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function parseCoverCaptionDraft(
  value: unknown,
): { alt: string; title: string } | null {
  if (value === null || typeof value !== "object") return null
  const obj = value as Record<string, unknown>
  const alt = typeof obj.alt === "string" ? sanitizeCoverCaptionText(obj.alt) : ""
  const title = typeof obj.title === "string" ? sanitizeCoverCaptionText(obj.title) : ""
  if (alt.length === 0 && title.length === 0) return null
  return {
    alt: clip(alt || title, MAX_COVER_ALT_LENGTH),
    title: clip(title || alt, MAX_COVER_TITLE_LENGTH),
  }
}

export function coverCaptionSystemPrompt(): string {
  return `Tu rédiges les métadonnées SEO d'une image déjà générée pour un site vitrine francophone.
Réponds UNIQUEMENT par un objet JSON {"alt":"...","title":"..."}.
alt : phrase FR descriptive, ≤ 125 caractères, mot-clé s'il est fourni, une seule fois. Pas de « image de », « photo de ». N'invente ni SIRET, ni raison sociale, ni adresse.
title : titre court optimisé, ≤ 70 caractères, mot-clé près du début s'il tient.`
}

export function coverCaptionUserPrompt(input: {
  title: string
  excerpt?: string
  targetKeyword?: string
}): string {
  return [
    `Titre : ${input.title}`,
    input.excerpt ? `Chapô : ${input.excerpt}` : null,
    input.targetKeyword ? `Mot-clé : ${input.targetKeyword}` : "Aucun mot-clé saisi.",
  ]
    .filter(Boolean)
    .join("\n")
}

export function coverCaption(input: {
  title: string
  excerpt?: string
  targetKeyword?: string
}): { alt: string; title: string } {
  const title = sanitizeCoverCaptionText(input.title)
  const keyword = sanitizeCoverCaptionText(input.targetKeyword ?? "")
  const excerpt = sanitizeCoverCaptionText(input.excerpt ?? "")
  const imageTitle = clip(title || keyword, MAX_COVER_TITLE_LENGTH)

  const parts: string[] = []
  if (title.length > 0) parts.push(title)
  if (keyword.length > 0 && countPhrase(parts.join(" "), keyword) === 0) {
    parts.push(keyword)
  } else if (excerpt.length > 0 && countPhrase(parts.join(" "), excerpt) === 0) {
    parts.push(excerpt)
  }

  const alt = clip(parts.join(" — "), MAX_COVER_ALT_LENGTH)
  return { alt, title: imageTitle }
}

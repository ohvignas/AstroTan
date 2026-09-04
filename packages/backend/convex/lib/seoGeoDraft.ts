import {
  MAX_EXCERPT_LENGTH,
  MAX_GEO_ANSWER_LENGTH,
  MAX_GEO_ENTITIES,
  MAX_GEO_ENTITY_LENGTH,
  MAX_GEO_FAQ_ITEMS,
  MAX_GEO_QUESTION_LENGTH,
  MAX_GEO_SUMMARY_LENGTH,
  MAX_SEO_DESCRIPTION_LENGTH,
  MAX_SEO_TITLE_LENGTH,
} from "../content"

/** Au-delà, le corps d'un article n'apporte plus rien au modèle. */
export const MAX_PROMPT_BODY_LENGTH = 6_000

export type SeoGeoDraft = {
  seo: { title: string; description: string }
  geo: {
    summary: string
    faq: { question: string; answer: string }[]
    entities: string[]
    noai: boolean
  }
  excerpt?: string
}

type SiteBits = {
  publicUrl?: string
  siteName?: string
  homePageSlug?: string
  declaredDomain?: string
  defaultSeoTitle?: string
  defaultSeoDescription?: string
  targetKeyword?: string
  serpLocationCode?: number
  serpLanguageCode?: string
  socials?: string[]
  seo?: { title?: string; description?: string }
  geo?: Partial<SeoGeoDraft["geo"]>
}

export type GenerationSource =
  | (SiteBits & { kind: "page"; title: string; slug: string })
  | (SiteBits & {
      kind: "post"
      title: string
      slug: string
      excerpt?: string
      body?: string
    })

export function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}

export function sourcePayload(source: GenerationSource): Record<string, unknown> {
  const shared = {
    title: source.title,
    slug: source.slug,
    publicUrl: source.publicUrl,
    siteName: source.siteName,
    homePageSlug: source.homePageSlug,
    declaredDomain: source.declaredDomain,
    targetKeyword: source.targetKeyword,
    seo: source.seo,
    geo: source.geo,
  }
  if (source.kind === "page") return { kind: "page", ...shared }
  return {
    kind: "post",
    ...shared,
    excerpt: source.excerpt,
    body: clip(source.body ?? "", MAX_PROMPT_BODY_LENGTH),
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = asString(value)
    if (text.length > 0) return text
  }
  return ""
}

function asFaq(value: unknown): { question: string; answer: string }[] {
  if (!Array.isArray(value)) return []
  const items: { question: string; answer: string }[] = []
  for (const raw of value) {
    if (items.length >= MAX_GEO_FAQ_ITEMS) break
    if (raw === null || typeof raw !== "object") continue
    const question = clip(asString((raw as { question?: unknown }).question), MAX_GEO_QUESTION_LENGTH)
    const answer = clip(asString((raw as { answer?: unknown }).answer), MAX_GEO_ANSWER_LENGTH)
    if (question.length === 0 || answer.length === 0) continue
    items.push({ question, answer })
  }
  return items
}

function asEntities(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const entities: string[] = []
  for (const raw of value) {
    if (entities.length >= MAX_GEO_ENTITIES) break
    const entity = clip(asString(raw), MAX_GEO_ENTITY_LENGTH)
    if (entity.length === 0) continue
    entities.push(entity)
  }
  return entities
}

/**
 * Accepte les clés plates (`seoTitle`) ET l'objet imbriqué `{ seo, geo }`
 * que les flagships renvoient en miroir du payload. Sans ça, un JSON
 * valide produisait un brouillon vide → « réponse inutilisable ».
 */
export function draftFromModel(raw: unknown, existingNoai: boolean): SeoGeoDraft {
  const obj = asRecord(raw)
  const seo = asRecord(obj.seo)
  const geo = asRecord(obj.geo)
  const noaiRaw = obj.geoNoai ?? geo.noai
  const excerpt = clip(asString(obj.excerpt), MAX_EXCERPT_LENGTH)
  return {
    seo: {
      title: clip(firstString(obj.seoTitle, seo.title), MAX_SEO_TITLE_LENGTH),
      description: clip(
        firstString(obj.seoDescription, seo.description),
        MAX_SEO_DESCRIPTION_LENGTH,
      ),
    },
    geo: {
      summary: clip(firstString(obj.geoSummary, geo.summary), MAX_GEO_SUMMARY_LENGTH),
      faq: asFaq(obj.geoFaq ?? geo.faq),
      entities: asEntities(obj.geoEntities ?? geo.entities),
      noai: typeof noaiRaw === "boolean" ? noaiRaw : existingNoai,
    },
    ...(excerpt.length > 0 ? { excerpt } : {}),
  }
}

export function isEmptyDraft(draft: SeoGeoDraft): boolean {
  return (
    draft.seo.title.length === 0 &&
    draft.seo.description.length === 0 &&
    draft.geo.summary.length === 0
  )
}

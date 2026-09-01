export type PaperFields = {
  title: string
  seoTitle: string
  seoDescription: string
  targetKeyword: string
  slug: string
  webOrigin?: string
}

export type PaperAttributes = {
  keyword: string
  description: string
  title: string
  slug: string
  permalink: string
  locale: "fr_FR"
  textTitle: string
}

export function postPermalink(webOrigin: string | undefined, slug: string): string {
  const base = webOrigin?.trim().replace(/\/+$/, "") ?? ""
  if (base.length === 0 || slug.trim().length === 0) return ""
  return `${base}/blog/${slug.trim()}`
}

export function paperAttributes(fields: PaperFields): PaperAttributes {
  const title = fields.title.trim()
  const seoTitle = fields.seoTitle.trim()
  return {
    keyword: fields.targetKeyword.trim(),
    description: fields.seoDescription.trim(),
    title: seoTitle || title,
    slug: fields.slug.trim(),
    permalink: postPermalink(fields.webOrigin, fields.slug),
    locale: "fr_FR",
    textTitle: title,
  }
}

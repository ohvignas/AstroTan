export type SeoFields<T extends string = string> = {
  title: string
  description: string
  canonicalUrl: string
  noindex: boolean
  ogImageId?: T | null
}

export function buildSeo<T extends string = string>({
  existing,
  fields,
}: {
  existing?: { ogImageId?: T }
  fields: SeoFields<T>
}): {
  title?: string
  description?: string
  canonicalUrl?: string
  noindex: boolean
  ogImageId?: T
} {
  const title = fields.title.trim() || undefined
  const description = fields.description.trim() || undefined
  const canonicalUrl = fields.canonicalUrl.trim() || undefined

  let ogImageId: T | undefined
  if (fields.ogImageId === null) {
    ogImageId = undefined
  } else if (fields.ogImageId !== undefined) {
    ogImageId = fields.ogImageId
  } else {
    ogImageId = existing?.ogImageId
  }

  return {
    title,
    description,
    canonicalUrl,
    noindex: fields.noindex,
    ...(ogImageId === undefined ? {} : { ogImageId }),
  }
}

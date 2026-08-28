// Structured data — the format answer engines quote most reliably.
//
// Everything here is built from the same fields the `<meta>` tags use, so
// the two cannot describe the page differently. `geo.faq` finally gets its
// reader: `FAQPage` is what that field was added for, and it has had no
// consumer since it was introduced.
//
// Nothing in this module is emitted for a page carrying `geo.noai` — that
// switch exists so an operator can keep a page indexable while asking that
// its content not be reproduced, and publishing an extract designed to be
// quoted would empty it of meaning. The caller enforces that; see
// `PageHead.astro`.

export interface SiteIdentity {
  siteName: string
  logoUrl: string | null
  socials: { label: string; url: string }[]
}

/**
 * Serialise for injection inside a `<script type="application/ld+json">`.
 *
 * A raw `JSON.stringify` there is an injection: the browser scans for the
 * literal string `</script>` without caring about the JSON around it, so a
 * title containing one closes the block and everything after it becomes
 * executable markup. Escaping `<`, `>` and `&` as unicode escapes keeps the
 * output valid JSON while making that impossible.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
}

export function organizationJsonLd(
  site: SiteIdentity,
  origin: string
): Record<string, unknown> {
  // Fields are omitted rather than emitted empty: a consumer reads
  // `logo: ""` as a URL and fails on it, where an absent key is simply
  // absent.
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.siteName,
    url: origin,
    ...(site.logoUrl ? { logo: site.logoUrl } : {}),
    ...(site.socials.length > 0
      ? { sameAs: site.socials.map((social) => social.url) }
      : {}),
  }
}

export function articleJsonLd(
  post: {
    title: string
    excerpt?: string
    publishedAt?: number
    coverUrl?: string | null
  },
  site: SiteIdentity,
  url: string
): Record<string, unknown> | null {
  // `datePublished` is required by the vocabulary. Emitting the object with
  // a fabricated date would be worse than not emitting it — a validator
  // would accept it and the date would be a lie.
  if (post.publishedAt === undefined) return null

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    mainEntityOfPage: url,
    datePublished: new Date(post.publishedAt).toISOString(),
    dateModified: new Date(post.publishedAt).toISOString(),
    ...(post.excerpt ? { description: post.excerpt } : {}),
    ...(post.coverUrl ? { image: post.coverUrl } : {}),
    publisher: {
      "@type": "Organization",
      name: site.siteName,
      ...(site.logoUrl ? { logo: site.logoUrl } : {}),
    },
  }
}

export function faqJsonLd(
  faq: { question: string; answer: string }[] | undefined
): { "@type": string; mainEntity: Record<string, unknown>[] } | null {
  // A pair missing either half produces a `Question` with no
  // `acceptedAnswer`, which validators reject — and one bad entry
  // invalidates the whole block, taking the good ones with it.
  const usable = (faq ?? []).filter(
    (item) => item.question.trim().length > 0 && item.answer.trim().length > 0
  )
  if (usable.length === 0) return null

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: usable.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  } as { "@type": string; mainEntity: Record<string, unknown>[] }
}

export function breadcrumbJsonLd(
  trail: { name: string; url: string }[]
): { itemListElement: { position: number; name: string }[] } | null {
  if (trail.length === 0) return null
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    // Positions are 1-based in the vocabulary, not 0-based.
    itemListElement: trail.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: step.url,
    })),
  } as { itemListElement: { position: number; name: string }[] }
}

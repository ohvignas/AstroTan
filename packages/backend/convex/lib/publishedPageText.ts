import { htmlToMainMarkdown } from "./cleanDocumentForRag"
import { publicUrl } from "./publicPath"

export const MAX_PUBLISHED_PAGE_CHARS = 8_000

export function extractTextFromHtml(html: string): string {
  return htmlToMainMarkdown(html)
}

export function publishedPageUrl(
  siteUrl: string,
  slug: string,
  homePageSlug?: string | null,
): string {
  const home = homePageSlug ?? "accueil"
  return publicUrl(siteUrl, slug.length > 0 ? slug : home, home)
}

export async function fetchPublishedText(
  siteUrl: string | undefined,
  slug: string,
  homePageSlug?: string | null,
): Promise<string | null> {
  if (!siteUrl) return null
  const url = publishedPageUrl(siteUrl, slug, homePageSlug)
  const response = await fetch(url)
  if (!response.ok) return null
  const html = await response.text()
  return extractTextFromHtml(html).slice(0, MAX_PUBLISHED_PAGE_CHARS)
}

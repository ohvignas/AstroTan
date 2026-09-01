import { publicUrl } from "./publicPath"

export const MAX_PUBLISHED_PAGE_CHARS = 8_000

export function extractTextFromHtml(html: string): string {
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
  return stripped.replace(/\s+/g, " ").trim()
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

// `sitemap.xml` and `llms.txt` — the two files that tell a machine what
// this site contains.
//
// Pure functions, so the thing worth testing is testable without an Astro
// context: what goes in each file, and above all what must not.
//
// One invariant governs both: nothing unpublished, nothing unreachable, and
// nothing whose operator asked that it not be reproduced. A sitemap listing
// a draft is a leak; a sitemap listing a published row with no route file
// is a lie, because that URL answers 404.

interface Seo {
  noindex?: boolean
  description?: string
}

interface Geo {
  summary?: string
  noai?: boolean
}

interface Entry {
  slug: string
  title: string
  publishedAt?: number
  excerpt?: string
  seo?: Seo
  geo?: Geo
}

interface Input {
  origin: string
  pages: Entry[]
  posts: Entry[]
  /** Exact paths a route file answers on — `servedPaths.generated.ts`. */
  servedPaths: readonly string[]
  /**
   * The slug chosen in the dashboard as the home page, if any.
   *
   * It needs its own parameter because it is the one page whose slug and
   * path differ: its row says `accueil`, it answers at `/`. Without it the
   * home page — the site's most important URL — was simply absent from both
   * files, which is exactly what the first real output showed.
   */
  homePageSlug?: string | null
}

/**
 * Escape the five XML entities.
 *
 * String-concatenated XML breaks on the first ampersand in a slug or a
 * title: the parser stops there and the whole document becomes unreadable,
 * silently, because nothing fetches a sitemap and reports back.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** The path a page answers on, or `null` when nothing serves it. */
function pathOf(
  page: Entry,
  servedPaths: readonly string[],
  homePageSlug?: string | null
): string | null {
  if (homePageSlug && page.slug === homePageSlug) return "/"
  return servedPaths.includes(`/${page.slug}`) ? `/${page.slug}` : null
}

/**
 * The pages a crawler can actually reach, each with its path.
 *
 * A published row without its `.astro` file answers 404 — the two halves of
 * a page, and the dashboard owns only one. Listing it would send a crawler
 * to a page that does not exist.
 */
function livePages(
  pages: Entry[],
  servedPaths: readonly string[],
  homePageSlug?: string | null
): { page: Entry; path: string }[] {
  return pages
    .map((page) => ({ page, path: pathOf(page, servedPaths, homePageSlug) }))
    .filter((entry): entry is { page: Entry; path: string } => entry.path !== null)
}

export function buildSitemap({
  origin,
  pages,
  posts,
  servedPaths,
  homePageSlug,
}: Input): string {
  const published = posts.filter((post) => !post.seo?.noindex)

  const entries: { loc: string; lastmod?: number }[] = [
    ...livePages(pages, servedPaths, homePageSlug)
      // Listing a page while asking for its de-indexation contradicts
      // itself; the crawler resolves the contradiction however it likes.
      .filter(({ page }) => !page.seo?.noindex)
      .map(({ page, path }) => ({
        loc: `${origin}${path === "/" ? "" : path}`,
        lastmod: page.publishedAt,
      })),
    // The blog index is a page of the site with no row of its own — it is
    // pure code. Listed only when it has something to list, so an empty
    // blog does not advertise an empty page.
    ...(published.length > 0 && servedPaths.includes("/blog")
      ? [{ loc: `${origin}/blog`, lastmod: published[0]?.publishedAt }]
      : []),
    ...published.map((post) => ({
      loc: `${origin}/blog/${post.slug}`,
      lastmod: post.publishedAt,
    })),
  ]

  const urls = entries
    .map(({ loc, lastmod }) => {
      const modified =
        lastmod === undefined
          ? ""
          : `\n    <lastmod>${new Date(lastmod).toISOString()}</lastmod>`
      return `  <url>\n    <loc>${escapeXml(loc)}</loc>${modified}\n  </url>`
    })
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}

/**
 * `llms.txt` — the GEO counterpart of the sitemap.
 *
 * What an answer engine reads to learn what this site holds, with each
 * entry's own summary rather than its raw content. Anything carrying `noai`
 * is absent: that switch exists so an operator can stay indexed while
 * refusing reproduction, and publishing a summary built to be quoted would
 * empty it of meaning.
 */
export function buildLlmsTxt({
  origin,
  siteName,
  pages,
  posts,
  servedPaths,
  homePageSlug,
}: Input & { siteName: string }): string {
  const describe = (entry: Entry): string =>
    entry.geo?.summary ?? entry.seo?.description ?? entry.excerpt ?? ""

  const line = (entry: Entry, path: string): string => {
    const summary = describe(entry).trim()
    const url = `${origin}${path === "/" ? "" : path}`
    return `- [${entry.title}](${url})${summary ? `: ${summary}` : ""}`
  }

  const quotablePages = livePages(pages, servedPaths, homePageSlug).filter(
    ({ page }) => !page.geo?.noai && !page.seo?.noindex
  )
  const quotablePosts = posts.filter(
    (post) => !post.geo?.noai && !post.seo?.noindex
  )

  const sections = [`# ${siteName}`, ""]

  if (quotablePages.length > 0) {
    sections.push("## Pages", "")
    sections.push(...quotablePages.map(({ page, path }) => line(page, path)))
    sections.push("")
  }
  if (quotablePosts.length > 0) {
    sections.push("## Articles", "")
    sections.push(...quotablePosts.map((post) => line(post, `/blog/${post.slug}`)))
    sections.push("")
  }

  return sections.join("\n")
}

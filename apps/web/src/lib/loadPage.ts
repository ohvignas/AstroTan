import type { AstroGlobal } from "astro"
import { api } from "@astrotan/backend/convex/_generated/api"
import { getConvexClient } from "./convexClient"
import { verifyPreviewToken } from "./previewToken"

// The three lines every page of this site starts with.
//
// A page *is* its `.astro` file: the markup, the layout, the words. What
// this fetches is the row the dashboard owns — whether the page is live,
// and how it should be found. Nothing here can change what the page looks
// like, and that is deliberate.

export interface PageRecord {
  _id: string
  slug: string
  title: string
  status: "draft" | "published"
  publishedAt?: number
  seo?: {
    title?: string
    description?: string
    canonicalUrl?: string
    noindex?: boolean
  }
  geo?: {
    summary?: string
    faq?: { question: string; answer: string }[]
    entities?: string[]
    noai?: boolean
  }
}

export interface LoadedPage {
  /** `null` when the page is not live — the caller renders its 404 body. */
  page: PageRecord | null
  /** `true` when reached through a valid preview token rather than published. */
  preview: boolean
}

/**
 * Load a page's row, honouring publication and preview, and set the
 * response's status and cache headers to match.
 *
 * Preview arrives as `?t=<token>` on the page's own URL rather than through
 * a separate `/preview/...` route, so what an editor checks before
 * publishing is literally the page that will go live — same file, same
 * markup, only the publication gate lifted. The token is verified twice:
 * once by the HMAC here, and again inside Convex by `previewPage`.
 */
export async function loadPage(
  astro: AstroGlobal,
  slug: string
): Promise<LoadedPage> {
  const token = astro.url.searchParams.get("t")

  if (token !== null && token !== "") {
    // First of the two barriers (CLAUDE.md invariant 2). Checking the HMAC
    // here, before any network call, is what keeps a forged or expired
    // token from even reaching Convex — and what makes the second check,
    // inside `previewPage`, a genuinely independent one rather than the
    // only one. Neither is allowed to be dropped in favour of the other:
    // this app has no session and no admin key, so the token is the whole
    // authorisation.
    const wellFormed = verifyPreviewToken({
      type: "page",
      id: slug,
      token,
    })

    let page: PageRecord | null = null
    if (wellFormed) try {
      page = (await getConvexClient().query(api.pages.previewPage, {
        slug,
        token,
      })) as PageRecord | null
    } catch {
      // A bad, expired or forged token is not an error to surface — it is
      // simply not a preview. Falling through to the published lookup is
      // what makes a stale link behave like an ordinary visit rather than
      // leaking that the page exists.
      page = null
    }
    if (page !== null) {
      // Never cached, and never indexed: a preview URL that got shared or
      // crawled must not become the version everyone sees.
      astro.cache.set(false)
      astro.response.headers.set("x-robots-tag", "noindex, nofollow")
      return { page, preview: true }
    }
  }

  const page = (await getConvexClient().query(api.pages.getPublishedPage, {
    slug,
  })) as PageRecord | null

  if (page === null) {
    // A real 404, never cached: simpler to reason about than caching a
    // negative result and relying on a future publish of this exact slug
    // to remember to invalidate it.
    astro.response.status = 404
    astro.cache.set(false)
    return { page: null, preview: false }
  }

  // The per-page tag `publishPage`'s outbox invalidates, alongside the
  // route-wide `pages` tag — this is what puts an edit live in seconds
  // instead of waiting out `maxAge`.
  astro.cache.set({ maxAge: 300, swr: 600, tags: ["pages", `page:${slug}`] })
  return { page, preview: false }
}

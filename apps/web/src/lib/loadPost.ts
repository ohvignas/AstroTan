import type { AstroGlobal } from "astro"
import { api } from "@astrotan/backend/convex/_generated/api"
import { getConvexClient } from "./convexClient"
import { verifyPreviewToken } from "./previewToken"

// The article equivalent of `loadPage`. Same shape, same two barriers, same
// silent fallback — read that file first; this one only notes what differs.
//
// What differs: a post carries its content in the database. Pages do not —
// a page is its `.astro` file. That exception exists because a blog article
// *is* content, and nobody will ask an agent to write each one.

export interface PostRecord {
  _id: string
  slug: string
  title: string
  status: "draft" | "published"
  body: string
  excerpt?: string
  coverId?: string
  // Résolus côté serveur par `withCover`, mais SEULEMENT sur le chemin
  // publié (`getPublishedPost`) : `previewPost` renvoie la ligne brute.
  // D'où l'optionalité, et d'où le repli sur `media.publicUrl` dans
  // `/blog/[slug]` — c'est ce qui fait qu'un brouillon en aperçu montre sa
  // couverture au lieu d'un cadre vide.
  //
  // Cette interface est écrite à la main à côté du schéma Convex : les deux
  // ne peuvent pas diverger bruyamment. `coverUrl` manquait ici alors que la
  // page le lisait, et la couverture ne s'affichait donc jamais — sans
  // erreur, sans avertissement, jusqu'à ce qu'`astro check` soit lancé.
  coverUrl?: string | null
  coverAlt?: string
  publishedAt?: number
  tagIds: string[]
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

export interface LoadedPost {
  post: PostRecord | null
  preview: boolean
}

/**
 * Load one article, honouring publication and preview, and set the
 * response's status and cache headers to match.
 *
 * The preview token's type is `"post"`, and the HMAC covers that type — so a
 * token minted for a *page* cannot open an article, even one whose slug
 * matches exactly.
 */
export async function loadPost(
  astro: AstroGlobal,
  slug: string
): Promise<LoadedPost> {
  const token = astro.url.searchParams.get("t")

  if (token !== null && token !== "") {
    // First of the two barriers (CLAUDE.md invariant 2): the HMAC is checked
    // here, before any network call, which is what makes the second check
    // inside `posts.previewPost` a genuinely independent one rather than
    // the only one.
    const wellFormed = verifyPreviewToken({ type: "post", id: slug, token })

    let post: PostRecord | null = null
    if (wellFormed)
      try {
        post = (await getConvexClient().query(api.posts.previewPost, {
          slug,
          token,
        })) as PostRecord | null
      } catch {
        // A bad, expired or forged token is not an error to show — it is
        // simply not a preview. Falling through to the published lookup is
        // what makes a stale link behave like an ordinary visit rather than
        // revealing that the article exists.
        post = null
      }
    if (post !== null) {
      astro.cache.set(false)
      astro.response.headers.set("x-robots-tag", "noindex, nofollow")
      astro.locals.preview = true
      return { post, preview: true }
    }
  }

  const post = (await getConvexClient().query(api.posts.getPublishedPost, {
    slug,
  })) as PostRecord | null

  if (post === null) {
    astro.response.status = 404
    astro.cache.set(false)
    return { post: null, preview: false }
  }

  // `post:{slug}` is the tag `publishPost`'s outbox invalidates, alongside
  // the route-wide `posts` tag that `/blog` carries.
  astro.cache.set({ maxAge: 300, swr: 600, tags: ["posts", `post:${slug}`] })
  return { post, preview: false }
}

/**
 * La forme d'un article telle que la liste et les cartes la consomment.
 *
 * Vit ici plutôt que dans `BlogCard.astro` parce qu'un type exporté depuis
 * un `.astro` n'est pas importable de façon fiable : le composant se charge,
 * le type non, et l'erreur ne sort qu'au `astro check`.
 */
export interface PostSummary {
  slug: string
  title: string
  excerpt?: string
  body: string
  coverUrl?: string | null
  coverAlt?: string
  publishedAt?: number
}

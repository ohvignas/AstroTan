import { ConvexError, v } from "convex/values"

// ---------------------------------------------------------------------
// What a page is
//
// A page's markup — and its words — live in an `.astro` file, written in
// code. The database holds no content at all: not a block tree, not a
// Markdown body, not a map of text slots. Every one of those is a second,
// weaker way to do a job the code already does, and each fights the code
// the moment the two disagree.
//
// What the row carries instead is everything that decides how the page is
// *found* and whether it is live: its slug, its title, its publication
// state, and the SEO and GEO fields below. The split is the whole point —
// the dashboard answers "who should find this page", the codebase answers
// "what it is and what it looks like".
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Length bounds
//
// Convex's `v.string()` has no built-in maximum length — a string field
// accepts anything up to the 1 MB document ceiling. Lot 1 shipped two
// fields with no application-level bound of their own (a profile display
// name, an invitation email) and both landed unbounded in an interface.
// These constants are that bound for every text field a page can carry,
// named so the editor can import the same numbers and cap its inputs
// instead of re-guessing them, and enforced at runtime by
// `assertPageTextWithinLimits`.
// ---------------------------------------------------------------------

export const MAX_PAGE_TITLE_LENGTH = 200 // <title> / nav labels — generous but not unbounded
export const MAX_SLUG_LENGTH = 200 // URL path segment; an operator-facing text input

// `pages.seo` — mirrors design spec §6.5 (title, description, ogImage,
// canonical, noindex). `title`/`description` bounds follow the point past
// which Google truncates a search-result snippet; there's no protocol
// limit worth naming for `canonicalUrl`, so it gets a generous practical
// ceiling instead.
export const MAX_SEO_TITLE_LENGTH = 70
export const MAX_SEO_DESCRIPTION_LENGTH = 160
export const MAX_CANONICAL_URL_LENGTH = 2048

// `pages.geo` — Generative Engine Optimization: what an answer engine
// needs in order to quote this page correctly rather than paraphrase it
// wrongly. Every field here exists because it maps onto something a
// machine actually consumes, not because it sounded thorough:
//
//   summary   → the extractable abstract; also what `llms.txt` lists
//   faq       → emitted as FAQPage JSON-LD, the format answer engines
//               quote most reliably
//   entities  → the things the page is *about*, for disambiguation
//               ("Mercury" the planet vs the element)
//
// `summary` is capped near the length a model will actually lift as a
// standalone answer; past that it stops being an abstract.
export const MAX_GEO_SUMMARY_LENGTH = 500
export const MAX_GEO_QUESTION_LENGTH = 200
export const MAX_GEO_ANSWER_LENGTH = 1000
export const MAX_GEO_FAQ_ITEMS = 20
export const MAX_GEO_ENTITY_LENGTH = 100
export const MAX_GEO_ENTITIES = 20

// ---------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------

// All optional: a page with no `seo` override falls back to
// `settings.defaultSeo`. Lives here rather than inline in `schema.ts` so
// `pages.update` can declare the exact same validator on its own `seo`
// argument instead of hand-copying its shape — the two would otherwise be
// free to drift apart silently, one accepting a field the other rejects.
export const seoValidator = v.object({
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  ogImageId: v.optional(v.id("_storage")),
  canonicalUrl: v.optional(v.string()),
  noindex: v.optional(v.boolean()),
})

export const geoValidator = v.object({
  summary: v.optional(v.string()),
  faq: v.optional(
    v.array(v.object({ question: v.string(), answer: v.string() }))
  ),
  entities: v.optional(v.array(v.string())),
  // Distinct from `seo.noindex`: a page can be perfectly indexable by a
  // search crawler and still be one the operator does not want reproduced
  // by an answer engine. Collapsing the two would silently take a decision
  // that isn't ours to take.
  noai: v.optional(v.boolean()),
})

export type PageSeoInput = {
  title?: string
  description?: string
  canonicalUrl?: string
}

export type PageGeoInput = {
  summary?: string
  faq?: { question: string; answer: string }[]
  entities?: string[]
  noai?: boolean
}

// ---------------------------------------------------------------------
// Runtime enforcement
// ---------------------------------------------------------------------

function assertLength(value: string, max: number, field: string): void {
  if (value.length > max) {
    throw new ConvexError({ code: "FIELD_TOO_LONG", field, max })
  }
}

function assertCount(length: number, max: number, field: string): void {
  if (length > max) {
    throw new ConvexError({ code: "FIELD_TOO_MANY", field, max })
  }
}

/**
 * Every text field a page mutation writes, checked in one place. Called by
 * `pages.create` and `pages.update` before the insert/patch — not by the
 * editor, which can only ever be the second line of defence.
 */
export function assertPageTextWithinLimits(page: {
  title: string
  slug: string
  seo?: PageSeoInput
  geo?: PageGeoInput
}): void {
  assertLength(page.title, MAX_PAGE_TITLE_LENGTH, "title")
  assertLength(page.slug, MAX_SLUG_LENGTH, "slug")
  if (page.seo?.title !== undefined) {
    assertLength(page.seo.title, MAX_SEO_TITLE_LENGTH, "seo.title")
  }
  if (page.seo?.description !== undefined) {
    assertLength(page.seo.description, MAX_SEO_DESCRIPTION_LENGTH, "seo.description")
  }
  if (page.seo?.canonicalUrl !== undefined) {
    assertLength(page.seo.canonicalUrl, MAX_CANONICAL_URL_LENGTH, "seo.canonicalUrl")
  }

  if (page.geo?.summary !== undefined) {
    assertLength(page.geo.summary, MAX_GEO_SUMMARY_LENGTH, "geo.summary")
  }
  if (page.geo?.faq !== undefined) {
    assertCount(page.geo.faq.length, MAX_GEO_FAQ_ITEMS, "geo.faq")
    for (const [index, item] of page.geo.faq.entries()) {
      assertLength(item.question, MAX_GEO_QUESTION_LENGTH, `geo.faq[${index}].question`)
      assertLength(item.answer, MAX_GEO_ANSWER_LENGTH, `geo.faq[${index}].answer`)
    }
  }
  if (page.geo?.entities !== undefined) {
    assertCount(page.geo.entities.length, MAX_GEO_ENTITIES, "geo.entities")
    for (const [index, entity] of page.geo.entities.entries()) {
      assertLength(entity, MAX_GEO_ENTITY_LENGTH, `geo.entities[${index}]`)
    }
  }
}

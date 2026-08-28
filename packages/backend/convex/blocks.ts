import { ConvexError, v } from "convex/values"

// ---------------------------------------------------------------------
// Length bounds
//
// Convex's `v.string()` has no built-in maximum length — unlike
// `v.union(v.literal(...))`, which the schema itself enforces, a string
// field accepts anything up to the 1 MB document ceiling. Lot 1 shipped
// two fields with no application-level bound of their own (a profile
// display name, an invitation email) and both landed unbounded in an
// interface. These constants are that bound for every text field a page
// or a block can carry, named so Task 8's editor can import the same
// numbers and cap its inputs instead of re-guessing them, and enforced at
// runtime by `assertBlockWithinLimits` / `assertPageTextWithinLimits`
// below — the mutations Task 2/3 write are expected to call these before
// every insert/patch, the same way `profiles.updateMine` already does for
// `MAX_DISPLAY_NAME_LENGTH`.
// ---------------------------------------------------------------------

// Page-level (not part of any block).
export const MAX_PAGE_TITLE_LENGTH = 200 // <title> / nav labels — generous but not unbounded
export const MAX_SLUG_LENGTH = 200 // URL path segment; an operator-facing text input, same class of bug as the two above

// `pages.seo` — mirrors design spec §6.5 (title, description, ogImage,
// canonical, noindex). `title`/`description` bounds follow the point past
// which Google truncates a search-result snippet; there's no protocol
// limit worth naming for `canonicalUrl`, so it gets a generous practical
// ceiling instead.
export const MAX_SEO_TITLE_LENGTH = 70
export const MAX_SEO_DESCRIPTION_LENGTH = 160
export const MAX_CANONICAL_URL_LENGTH = 2048

// Block-level.
export const MAX_BLOCK_TITLE_LENGTH = 200 // hero.title, cta.title — large on-page headings
export const MAX_BLOCK_SUBTITLE_LENGTH = 300 // hero.subtitle
export const MAX_RICH_TEXT_HTML_LENGTH = 50_000 // richText.html — the one block meant to carry real copy
export const MAX_CTA_LABEL_LENGTH = 40 // button text; short by construction, not just by convention
export const MAX_CTA_HREF_LENGTH = 2048 // same practical URL ceiling as seo.canonicalUrl
export const MAX_FEATURE_ITEM_TITLE_LENGTH = 100
export const MAX_FEATURE_ITEM_BODY_LENGTH = 500
export const MAX_FAQ_QUESTION_LENGTH = 200
export const MAX_FAQ_ANSWER_LENGTH = 2000

// ---------------------------------------------------------------------
// Block shape
// ---------------------------------------------------------------------

const ctaValidator = v.object({ label: v.string(), href: v.string() })

// Embedded field, not a table (design spec §4 "Blocs"): reordering is one
// atomic mutation on `pages.blocks`, there's no N+1 at render time, and —
// because this is a *discriminated* union (every member has a literal
// `type`) — the type propagates to Task 5's `Record<Block["type"],
// AstroComponent>` registry, where TypeScript itself fails a block type
// added here without a matching `.astro` component. The 1 MB Convex
// document limit is far above what any real page's blocks amount to.
//
// `mediaId`/`mediaIds` reference `_storage` directly rather than a
// `media` table (which design spec §4 anticipates but no task in this lot
// creates) — matches the task brief's own code exactly; revisit once a
// `media` table exists.
export const blockValidator = v.union(
  v.object({
    type: v.literal("hero"),
    title: v.string(),
    subtitle: v.optional(v.string()),
    mediaId: v.optional(v.id("_storage")),
    cta: v.optional(ctaValidator),
  }),
  v.object({ type: v.literal("richText"), html: v.string() }),
  v.object({
    type: v.literal("features"),
    items: v.array(v.object({ title: v.string(), body: v.string() })),
  }),
  v.object({ type: v.literal("gallery"), mediaIds: v.array(v.id("_storage")) }),
  v.object({
    type: v.literal("faq"),
    items: v.array(v.object({ question: v.string(), answer: v.string() })),
  }),
  v.object({ type: v.literal("cta"), title: v.string(), cta: ctaValidator }),
)

export type Block = typeof blockValidator.type
export const BLOCK_TYPES = ["hero", "richText", "features", "gallery", "faq", "cta"] as const

// ---------------------------------------------------------------------
// Runtime length enforcement
//
// The union above bounds *shape and type* — Convex validates that for
// free on every write. It cannot bound *length*: `v.string()` accepts a
// megabyte-long title just as happily as a five-character one. These
// functions are the other half, meant to be called by every mutation that
// writes a block or a page's text fields, before the write — not by the
// schema, which has no hook for it.
// ---------------------------------------------------------------------

function assertLength(value: string, max: number, field: string): void {
  if (value.length > max) {
    throw new ConvexError({ code: "FIELD_TOO_LONG", field, max, actual: value.length })
  }
}

function assertCtaWithinLimits(cta: { label: string; href: string }, prefix: string): void {
  assertLength(cta.label, MAX_CTA_LABEL_LENGTH, `${prefix}.label`)
  assertLength(cta.href, MAX_CTA_HREF_LENGTH, `${prefix}.href`)
}

// Exhaustive `switch` over `Block["type"]`, not a generic "walk every
// string field" reflection helper: the `default` branch below assigns
// `block` to a `never`-typed binding, so adding a 7th block type to the
// union without adding a case here fails `tsc`, the same guarantee Task
// 5's render registry gets from the union itself.
export function assertBlockWithinLimits(block: Block): void {
  switch (block.type) {
    case "hero":
      assertLength(block.title, MAX_BLOCK_TITLE_LENGTH, "hero.title")
      if (block.subtitle !== undefined) {
        assertLength(block.subtitle, MAX_BLOCK_SUBTITLE_LENGTH, "hero.subtitle")
      }
      if (block.cta !== undefined) assertCtaWithinLimits(block.cta, "hero.cta")
      return
    case "richText":
      assertLength(block.html, MAX_RICH_TEXT_HTML_LENGTH, "richText.html")
      return
    case "features":
      block.items.forEach((item, i) => {
        assertLength(item.title, MAX_FEATURE_ITEM_TITLE_LENGTH, `features.items[${i}].title`)
        assertLength(item.body, MAX_FEATURE_ITEM_BODY_LENGTH, `features.items[${i}].body`)
      })
      return
    case "gallery":
      return // no text fields to bound
    case "faq":
      block.items.forEach((item, i) => {
        assertLength(item.question, MAX_FAQ_QUESTION_LENGTH, `faq.items[${i}].question`)
        assertLength(item.answer, MAX_FAQ_ANSWER_LENGTH, `faq.items[${i}].answer`)
      })
      return
    case "cta":
      assertLength(block.title, MAX_BLOCK_TITLE_LENGTH, "cta.title")
      assertCtaWithinLimits(block.cta, "cta.cta")
      return
    default: {
      const exhaustive: never = block
      throw new ConvexError({ code: "UNKNOWN_BLOCK_TYPE", block: exhaustive })
    }
  }
}

// Mirrors design spec §6.5 ("Champs SEO par page"). All optional: a page
// with no `seo` override falls back to `settings.defaultSeo` (a later
// task; not created by this one). Lives here, not in `schema.ts` where it
// used to be defined inline, so Task 8's `pages.update` can declare the
// exact same validator on its own `seo` argument instead of hand-copying
// its shape a second time — the two would otherwise be free to drift
// apart silently, one accepting a field the other rejects.
export const seoValidator = v.object({
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  ogImageId: v.optional(v.id("_storage")),
  canonicalUrl: v.optional(v.string()),
  noindex: v.optional(v.boolean()),
})

export type PageSeoInput = {
  title?: string
  description?: string
  canonicalUrl?: string
}

// Covers the two non-block text fields every page mutation writes
// (`title`, `slug`) plus the bounded subset of `seo`. Blocks are checked
// separately, one at a time, via `assertBlockWithinLimits` — a page's
// mutation is expected to call both.
export function assertPageTextWithinLimits(page: {
  title: string
  slug: string
  seo?: PageSeoInput
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
}

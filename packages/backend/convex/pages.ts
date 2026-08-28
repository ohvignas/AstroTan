import { ConvexError, v } from "convex/values"
import { query } from "./_generated/server"
import { verifyPreviewToken } from "./lib/previewToken"

// This task's own brief, verbatim: "the security-critical task of the
// whole lot — the boundary between what the public internet can read and
// what only a preview-token holder can read." Everything below exists to
// keep that boundary a *structural* fact, not a rule someone has to
// remember to re-apply on the eighth query.
//
// Two families, deliberately never sharing a helper (CLAUDE.md invariant
// #2; this file's own brief: "if a refactor ever makes them share a
// helper, the filter becomes a parameter, and a parameter can be wrong"):
//   - `getPublishedPage`/`listPublishedPages` — no token parameter of any
//     kind, `status === "published"` written inline, in this file, as a
//     plain comparison. Grep-able, not delegated to a shared "maybe
//     -filtered" fetch function with a flag some caller could get wrong.
//   - `previewPage` — a different function, reading by primary key
//     (`ctx.db.get`, not an index scan `getPublishedPage` also uses),
//     gated entirely by `lib/previewToken.ts`'s HMAC check. It does not
//     call, and is not called by, either query above.
//
// `convex/pages.publicQueryFamily.test.ts` is what turns "deliberately
// never sharing a helper" from a comment into an enforced property: it
// discovers every public query in this whole `convex/` tree that does
// *not* declare a `token` argument and asserts, for each one, that a
// freshly inserted draft never comes back — including a query nobody has
// written yet. See that file's header for why `token`-vs-not is a
// structural discriminant rather than a name this test has to be told
// about by hand.

// Preview tokens are type-agnostic in `lib/previewToken.ts` (it doesn't
// know what a "page" is); this is the one place that pins the literal for
// this table. A future `posts` table would define its own constant the
// same way, through the same primitive — never reusing this one, so a
// page-preview token can never be replayed against a post even if the two
// id spaces ever collided in shape.
const PREVIEW_TOKEN_TYPE = "page"

// No token parameter exists on this function's args at all — not merely
// "unused when absent". `by_slug` finds *a* page with this slug
// regardless of status (the index has no status component), so the
// `status !== "published"` comparison right here, against the row that
// index lookup actually returned, is what refuses a draft — not the index,
// which was never asked to distinguish the two.
export const getPublishedPage = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("pages")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique()
    if (page === null) return null
    if (page.status !== "published") return null
    return page
  },
})

// Same shape of guarantee as `getPublishedPage` above: no token parameter,
// and the `status === "published"` check is written twice on purpose —
// once as the index equality clause below, once again as an explicit
// `.filter` right after it. The second check is deliberately redundant
// with the first: if this query's index clause were ever edited to
// something other than a literal `"published"` (a variable, a
// broadened range), the explicit filter is what still keeps the
// invariant true rather than silently inheriting whatever the index
// clause was changed to.
export const listPublishedPages = query({
  args: {},
  handler: async (ctx) => {
    const pages = await ctx.db
      .query("pages")
      .withIndex("by_status", (q) => q.eq("status", "published"))
      .collect()
    return pages.filter((page) => page.status === "published")
  },
})

// The preview family. A *different* function from the two above — reads
// by primary key, not by either index they use, and calls neither of
// them. Gated entirely by `verifyPreviewToken`, never by session
// (`apps/web` carries none — CLAUDE.md invariant #1) and never by a
// `status` check of its own: a valid token for this exact id is
// sufficient to read the page regardless of whether it is a draft or
// already published, which is the whole point of a preview link.
//
// `token` is a required `v.string()` argument — Convex itself refuses a
// call that omits it entirely, before this handler ever runs, which is
// one of the "no token at all" cases this task's brief asks to prove
// refused. An empty-string token reaches the handler and is refused by
// `verifyPreviewToken` itself (no `.` separator to split on).
export const previewPage = query({
  args: { id: v.id("pages"), token: v.string() },
  handler: async (ctx, args) => {
    const valid = await verifyPreviewToken({
      type: PREVIEW_TOKEN_TYPE,
      id: args.id,
      token: args.token,
    })
    if (!valid) {
      throw new ConvexError({ code: "INVALID_PREVIEW_TOKEN" })
    }
    return ctx.db.get(args.id)
  },
})

import { ConvexError, v } from "convex/values"
import { mutation, query, type MutationCtx } from "./_generated/server"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { verifyPreviewToken, signPreviewToken, PREVIEW_TOKEN_TTL_MS } from "./lib/previewToken"
import { requireRole, requireOwnDocument, requirePublishedPageWritable } from "./lib/authz"
import { authComponent } from "./auth"
import { insertOutboxRow } from "./revalidate"
import { geoValidator, seoValidator, assertPageTextWithinLimits } from "./content"
import { MUTATION_REGISTRY } from "./_registry"

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

// ---------------------------------------------------------------------
// Lot 2, Task 8 — the page editor screen. Everything below is
// session-gated (`requireRole`), never anonymous like the two families
// above: this is the dashboard's own read/write surface, not something
// `apps/web` ever calls. Design spec §5's role table, verbatim: "editor:
// CRUD si createdBy = lui, lecture des autres" — an editor's *read*
// access to `pages` is unrestricted (`list`/`get` below apply no
// ownership filter at all, for any of the three roles), it is only the
// *write* mutations (`update`, `remove`) that narrow to
// `doc.createdBy === authUser._id` via `requireOwnDocument`
// (`lib/authz.ts`) — owner/admin bypass that check entirely. Publishing
// and unpublishing stay role-gated only (`requireRole(["owner","admin"])`,
// no ownership check at all, matching `publishPage` above and the same
// spec row's "publier" column): an editor is refused regardless of whose
// page it is, never just because it isn't theirs.
// ---------------------------------------------------------------------

// Every page, every role — the ownership boundary lives in the write
// mutations below, not here. `.order("desc")` (by `_creationTime`, the
// only ordering a plain `.collect()` has to offer without a dedicated
// index) surfaces the newest pages first, the order an operator scanning
// a list screen actually wants.
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    return ctx.db.query("pages").order("desc").collect()
  },
})

// A single page for the editor screen — `null` for a genuinely missing
// id (the screen renders a "not found" state), same convention as
// `ctx.db.get` itself. No `requireOwnDocument` call: per this section's
// own header comment, *reading* any page is open to all three roles —
// only `update`/`remove` narrow by ownership.
export const get = query({
  args: { id: v.id("pages") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    return ctx.db.get(args.id)
  },
})

// The outbox is the only place "did the last publish actually reach the
// live site" is recorded — this task's own brief, verbatim: "a screen
// that shows only 'published' wastes it." Rows are never deleted
// (`revalidate.ts`'s `markDone`/`markAttemptFailed` both `patch`, never
// `delete`), so the most recently *created* row tagged for this page's
// slug is that page's current propagation attempt — `publishPage` inserts
// a fresh row on every publish, so "most recent by `createdAt`" is always
// the outcome of the last publish, never a stale one from an earlier
// republish.
export const publicationStatus = query({
  args: { id: v.id("pages") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const page = await ctx.db.get(args.id)
    if (!page) return null
    if (page.status !== "published") {
      return { state: "draft" as const }
    }
    // M4 (whole-lot review): this used to `.collect()` the *entire*
    // `revalidationOutbox` table and filter in memory for
    // `tags.includes(tag)` — rows are never deleted (this table's own
    // header comment in `schema.ts`), so that scan grew by one row per
    // publish, forever, and this query is subscribed reactively by the
    // editor screen, re-running on *every* outbox insert anywhere in the
    // system, not just ones for this page. `by_page_created_at` turns
    // "this page's most recent outbox row" into a single index range
    // scan on `pageId`, ordered by `createdAt` with `_creationTime` as
    // Convex's own implicit tiebreaker — which also fixes the old
    // manual-reduce's strict-`>` bug where two rows sharing a
    // millisecond resolved to whichever the JS reduce saw first, not
    // necessarily the one actually inserted last.
    const latest = await ctx.db
      .query("revalidationOutbox")
      .withIndex("by_page_created_at", (q) => q.eq("pageId", args.id))
      .order("desc")
      .first()

    // Closing-fixes review: `by_page_created_at` is an index on
    // `["pageId", "createdAt"]` — a row written before `pageId` existed on
    // this table is structurally invisible to `q.eq("pageId", args.id)`
    // above, no matter how recent it is or what it actually recorded.
    // Treating "the index found nothing" as "settled, report published"
    // is the exact `!x -> allow` shape this whole review has flagged
    // everywhere else: a page whose *actual* last propagation attempt
    // failed would show a green "Publiée" badge, purely because the row
    // recording that failure isn't indexable by `pageId`.
    //
    // The fix costs one more *bounded* index range scan, not a table
    // scan: `pageId === undefined` is itself a valid equality clause on
    // this same index (confirmed against `convex-test`'s own index
    // semantics — an absent optional field is indexed like any other
    // value), and the set it returns can only ever shrink over time,
    // never grow like the table itself does, because every call site of
    // `insertOutboxRow` in this codebase already passes a real `pageId`.
    // Filtering that bounded, non-growing set down to this page's own tag
    // in memory is therefore safe for the same reason `by_page_created_at`
    // exists at all (M4's own comment above): it is never a scan of the
    // whole, ever-growing table, reactive subscription included.
    const unindexableRows = await ctx.db
      .query("revalidationOutbox")
      .withIndex("by_page_created_at", (q) => q.eq("pageId", undefined))
      .collect()
    const tag = `page:${page.slug}`
    const latestUnindexable = unindexableRows
      .filter((row) => row.tags.includes(tag))
      .reduce<(typeof unindexableRows)[number] | null>(
        (mostRecent, row) => (mostRecent === null || row.createdAt > mostRecent.createdAt ? row : mostRecent),
        null,
      )

    // Whichever candidate is actually the most recent decides what
    // follows: an unindexable row newer than (or the only one where)
    // `latest` exists means the true "did the last publish actually
    // land" answer isn't knowable from this page's own index scan at
    // all — reporting "unknown" is what lets the badge render that
    // honestly instead of guessing "published".
    if (latestUnindexable && (!latest || latestUnindexable.createdAt > latest.createdAt)) {
      return { state: "unknown" as const }
    }

    // No outbox row at all for an already-`published` page is a real,
    // if narrow, possibility (data seeded directly as `published` outside
    // `publishPage`, e.g. a fixture) — treated as settled rather than
    // stuck "propagating" forever with nothing to ever resolve it.
    if (!latest || latest.status === "done") {
      return { state: "published" as const, publishedAt: page.publishedAt }
    }
    if (latest.status === "failed") {
      return { state: "failed" as const, lastError: latest.lastError, attempts: latest.attempts }
    }
    return { state: "propagating" as const, attempts: latest.attempts }
  },
})

// A `[...slug].astro` rest param is a "/"-joined string with no leading
// or trailing slash (`apps/web/src/pages/[...slug].astro`'s own header
// comment) — trimming both here is what keeps an operator from ever
// creating a page whose stored slug can never actually match a request
// path, silently 404ing forever.
function normalizeSlug(raw: string): string {
  return raw.trim().replace(/^\/+/, "").replace(/\/+$/, "")
}

async function assertSlugAvailable(
  ctx: MutationCtx,
  slug: string,
  excludeId?: Id<"pages">,
): Promise<void> {
  const existing = await ctx.db
    .query("pages")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique()
  if (existing && existing._id !== excludeId) {
    throw new ConvexError({ code: "SLUG_ALREADY_EXISTS" })
  }
}

// Creates a brand-new draft — the only mutation on this table that
// inserts rather than patches. Open to all three roles: creating a page
// always makes it *this caller's own* (`createdBy: authUser._id`, never
// an argument), so there is structurally no way to create a page owned by
// someone else through this mutation — the same discipline
// `profiles.updateMine`'s own header comment describes for "no target
// parameter exists, so there is nothing to check after the fact."
export const create = mutation({
  args: { title: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const title = args.title.trim()
    const slug = normalizeSlug(args.slug)
    if (title.length === 0) throw new ConvexError({ code: "INVALID_TITLE" })
    if (slug.length === 0) throw new ConvexError({ code: "INVALID_SLUG" })
    assertPageTextWithinLimits({ title, slug })
    await assertSlugAvailable(ctx, slug)

    return ctx.db.insert("pages", {
      slug,
      title,
      status: "draft",
      body: "",
      createdBy: authUser._id,
      updatedBy: authUser._id,
    })
  },
})

// Patches title/slug/body/seo/geo on an existing page. `requireOwnDocument`
// is the ownership half of this section's own header comment: an editor
// may only reach the `ctx.db.patch` below when `page.createdBy` is their
// own id — owner/admin bypass that check and may edit any page. Every
// field is `v.optional` and patched only when the caller actually sent
// it, so a partial save (e.g. just the SEO panel) never has to first
// re-read and re-send the body it isn't touching.
export const update = mutation({
  args: {
    id: v.id("pages"),
    title: v.optional(v.string()),
    slug: v.optional(v.string()),
    body: v.optional(v.string()),
    seo: v.optional(seoValidator),
    geo: v.optional(geoValidator),
  },
  handler: async (ctx, args) => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const page = await ctx.db.get(args.id)
    if (!page) throw new ConvexError({ code: "NOT_FOUND" })
    requireOwnDocument(authUser, page)

    // H1 (whole-lot review): `requireOwnDocument` alone lets this
    // mutation compose into a public-content bypass. `publishPage` gates
    // on role, not ownership — so once *any* owner/admin has published a
    // page whose `createdBy` happens to be a given editor, that editor's
    // normal "edit my own document" access reaches straight into the
    // live, publicly served row (`getPublishedPage` has no separate
    // publish-time snapshot to fall back on — see this task's report for
    // why that isn't the fix). An editor may still freely edit their own
    // *draft*; only a published page is refused, and only for `editor` —
    // owner/admin already bypass `requireOwnDocument` above and are
    // unaffected by this check.
    //
    // H1 bis (closing fixes): the check itself now lives in
    // `lib/authz.ts` as `requirePublishedPageWritable` — an allow-list
    // (`PUBLISHED_PAGE_WRITE_ALLOWED`), not a deny-list on the literal
    // `"editor"` role, matching this same file's `OWNERSHIP_BYPASS`
    // convention. See that function's own header for why.
    requirePublishedPageWritable(authUser, page)

    const patch: {
      title?: string
      slug?: string
      body?: string
      seo?: typeof args.seo
      geo?: typeof args.geo
      updatedBy: string
    } = { updatedBy: authUser._id }

    if (args.title !== undefined) {
      const title = args.title.trim()
      if (title.length === 0) throw new ConvexError({ code: "INVALID_TITLE" })
      patch.title = title
    }
    if (args.slug !== undefined) {
      const slug = normalizeSlug(args.slug)
      if (slug.length === 0) throw new ConvexError({ code: "INVALID_SLUG" })
      await assertSlugAvailable(ctx, slug, args.id)
      patch.slug = slug
    }
    if (args.body !== undefined) patch.body = args.body
    if (args.seo !== undefined) patch.seo = args.seo
    if (args.geo !== undefined) patch.geo = args.geo

    // Bounds every text field that will actually land on the row after
    // this patch — the value just validated above where the caller sent
    // one, the already-stored (and therefore already-bounded) value
    // otherwise. Re-checking the untouched value is cheap and keeps this
    // one call the single place `update` ever asks "is this within
    // limits", rather than trusting a value this same handler didn't just
    // examine.
    assertPageTextWithinLimits({
      title: patch.title ?? page.title,
      slug: patch.slug ?? page.slug,
      body: patch.body ?? page.body,
      seo: patch.seo ?? page.seo,
      geo: patch.geo ?? page.geo,
    })

    await ctx.db.patch(args.id, patch)

    // M3 (whole-lot review): `update` used to be the only page mutation
    // with no `insertOutboxRow` call — `publishPage`/`remove`/`unpublish`
    // below all have one. Two distinct staleness bugs followed from that
    // gap: (1) saving an edit to an already-*published* page left the
    // cached response stale for up to `maxAge`/`swr` (astro.config.ts's
    // route rules) while the admin badge kept reading "Publiée", directly
    // contradicting the DoD's "propagates in under five seconds"; and (2)
    // renaming a published page's slug from `a` to `b` invalidated only
    // `page:b` on the *next* publish — the cached response still parked
    // under `page:a` would keep serving a page that should now 404 at
    // that URL, with nothing in this codebase ever invalidating it again.
    // `oldSlug`/`oldStatus` are read from `page` (fetched before the
    // patch above), so this is always the pre-patch state, not whatever
    // `patch` may have just changed it to.
    if (page.status === "published") {
      const tags = ["pages", `page:${page.slug}`]
      if (patch.slug !== undefined && patch.slug !== page.slug) {
        tags.push(`page:${patch.slug}`)
      }
      await insertOutboxRow(ctx, args.id, tags)
      await ctx.scheduler.runAfter(0, internal.revalidate.drain, {})
    }
  },
})

// Deletes a page outright. Same ownership gate as `update` — and, closing
// fixes review, the same `requirePublishedPageWritable` gate too: an
// editor cannot inject content by deleting a page (unlike `update`), but
// they can still unilaterally turn a live, publicly served URL into a
// 404 by deleting their own *published* page. "An editor does not change
// what the public site serves once it is published" applies to deletion
// exactly as much as it applies to editing — same allow-list, same
// owner/admin-only exemption, only `editor` refused. A published page's
// own tag is invalidated on the way out — without this, a cached response
// for a page that no longer exists would keep serving stale content for
// up to `maxAge`/`swr` (astro.config.ts's route rules) instead of the 404
// `[...slug].astro` would now render for that slug.
export const remove = mutation({
  args: { id: v.id("pages") },
  handler: async (ctx, args) => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const page = await ctx.db.get(args.id)
    if (!page) throw new ConvexError({ code: "NOT_FOUND" })
    requireOwnDocument(authUser, page)
    requirePublishedPageWritable(authUser, page)

    await ctx.db.delete(args.id)

    if (page.status === "published") {
      await insertOutboxRow(ctx, page._id, ["pages", `page:${page.slug}`])
      await ctx.scheduler.runAfter(0, internal.revalidate.drain, {})
    }
  },
})

// The inverse of `publishPage`: role-gated only, exactly like publishing
// itself — never ownership-gated, matching design spec §5's "publier"
// column, which lists only owner/admin, independent of `createdBy`. Also
// writes a fresh outbox row: a cached response for this page's tag must
// stop being served the instant it unpublishes, the same reasoning
// `publishPage` and `remove` above both already apply. `publishedAt` is
// left untouched — it stays as a historical "last time this went live"
// marker; nothing public ever reads it for a non-published page (
// `getPublishedPage` already refuses any row whose `status` isn't
// `"published"`, before this field would ever matter).
export const unpublish = mutation({
  args: { id: v.id("pages") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])
    const page = await ctx.db.get(args.id)
    if (!page) throw new ConvexError({ code: "NOT_FOUND" })
    if (page.status !== "published") return

    await ctx.db.patch(args.id, { status: "draft" })
    await insertOutboxRow(ctx, args.id, ["pages", `page:${page.slug}`])
    await ctx.scheduler.runAfter(0, internal.revalidate.drain, {})
  },
})

// Mints a preview token for the dashboard's "Preview" button — design
// spec §6.3, step 1 ("le dashboard demande un token à une action Convex").
// A `mutation`, not a `query`: this always has to mint a *fresh* token
// (`Date.now()` moves forward every call), and a Convex query is
// reactive/subscribed — nothing about `args.id` changes when the clock
// does, so a `query` version would hand back the same token forever
// rather than a freshly-dated one on every click. Role-gated only, no
// `requireOwnDocument`: same reasoning as `get`/`list` above — this only
// ever reveals what the caller could already read directly through `get`,
// packaged as a shareable link instead of a screen.
export const mintPreviewToken = mutation({
  args: { id: v.id("pages") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const page = await ctx.db.get(args.id)
    if (!page) throw new ConvexError({ code: "NOT_FOUND" })

    const expiresAt = Date.now() + PREVIEW_TOKEN_TTL_MS
    const token = await signPreviewToken({ type: PREVIEW_TOKEN_TYPE, id: args.id, expiresAt })
    return { token, expiresAt }
  },
})

// Lot 2, Task 3; design spec §6.2. The lot's third rule after "no draft
// leaks through a public query" and "a preview token is verified twice":
// publishing is `owner`/`admin` only, enforced here — not by the
// dashboard hiding a button, which an `editor` calling this mutation
// directly would simply bypass. Always flips an existing draft-or-published
// row to `published` — never creates one (`create`, Task 8, does that).
//
// The outbox insert and the scheduled `drain` call both happen inside
// this same handler, after the `status`/`publishedAt` patch: `insertOutboxRow`
// (`revalidate.ts`) is a plain `ctx.db.insert`, not a nested mutation
// call, so it commits atomically with the page write — see that module's
// header comment for why that's the whole point of an outbox. Republishing
// an already-published page still writes a fresh outbox row each time:
// every publish is a signal that whatever is live may be stale and needs
// invalidating again, even if `status` itself doesn't change.
export const publishPage = mutation({
  args: { id: v.id("pages") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])
    const page = await ctx.db.get(args.id)
    if (!page) throw new ConvexError({ code: "NOT_FOUND" })

    await ctx.db.patch(args.id, { status: "published", publishedAt: Date.now() })
    await insertOutboxRow(ctx, args.id, ["pages", `page:${page.slug}`])
    // The fast path (design spec §6.2, step 2): don't wait for the next
    // 60s cron sweep (`crons.ts`) when nothing is wrong. `runAfter(0, ...)`
    // schedules `drain` to run essentially immediately, once this
    // mutation's own transaction has committed — the cron is the recovery
    // path for when this specific call is lost, not the primary path.
    await ctx.scheduler.runAfter(0, internal.revalidate.drain, {})
  },
})

// Required by `_registry.test.ts`'s exhaustiveness check: every public
// mutation must be declared here. `publishPage` is the first mutation
// `pages.ts` exports — `owner`/`admin` only, `editor` refused with
// FORBIDDEN, exercised by `lib/authz.test.ts`'s per-role matrix against a
// real Better Auth session for all three roles.
// Fetches the *real* authenticated user's id from inside `t.run` — not a
// fixed placeholder like `publishPage`'s own entry above, which never
// needs one because `publishPage` isn't ownership-gated. `update`/`remove`
// below are: their `editor` case is only genuinely "allowed" (per this
// section's own `allowedRoles`) when the row it operates on is that exact
// caller's own document, so the fixture has to know who that is.
// `t.run`'s `ctx.auth` carries the identity `t` itself was constructed
// with (`identityFor`, `betterAuthFixture.ts`) — confirmed against
// `convex-test@0.0.56`'s own source (`testCtx.auth = authStorage.getStore()
// ?? auth`, closed over the identity `withIdentity` bound) — so
// `authComponent.safeGetAuthUser` resolves to the real Better Auth user
// behind this specific role's session, the same one `t.mutation(...)`
// itself will authenticate as a moment later.
async function registryActorId(t: any): Promise<string> {
  const authUser = await t.run((ctx: any) => authComponent.safeGetAuthUser(ctx))
  return (authUser as { _id: string })._id
}

MUTATION_REGISTRY.push(
  {
    name: "pages.publishPage",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const id = await t.run((ctx: any) =>
        ctx.db.insert("pages", {
          slug: `registry-publish-${Date.now()}-${Math.random()}`,
          title: "Registry Check",
          status: "draft",
          body: "",
          createdBy: "registry-check",
          updatedBy: "registry-check",
        }),
      )
      return t.mutation(api.pages.publishPage, { id })
    },
  },
  // `create` never needs a fixture document: it always makes the page it
  // inserts the caller's own (`createdBy: authUser._id`, not an argument),
  // so all three roles are honestly "allowed" here with nothing to set up.
  {
    name: "pages.create",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: (t) =>
      t.mutation(api.pages.create, {
        title: "Registry Check",
        slug: `registry-create-${Date.now()}-${Math.random()}`,
      }),
  },
  // Ownership-gated: the fixture page's `createdBy` is set to *this
  // role's own* real id (`registryActorId`), so an `editor` invocation is
  // genuinely editing its own document — the same shape of "allowed" a
  // real editor gets in production, not a fixture that happens to dodge
  // the ownership check some other way.
  {
    name: "pages.update",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const ownerId = await registryActorId(t)
      const id = await t.run((ctx: any) =>
        ctx.db.insert("pages", {
          slug: `registry-update-${Date.now()}-${Math.random()}`,
          title: "Registry Check",
          status: "draft",
          body: "",
          createdBy: ownerId,
          updatedBy: ownerId,
        }),
      )
      return t.mutation(api.pages.update, { id, title: "Registry Check Updated" })
    },
  },
  {
    name: "pages.remove",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const ownerId = await registryActorId(t)
      const id = await t.run((ctx: any) =>
        ctx.db.insert("pages", {
          slug: `registry-remove-${Date.now()}-${Math.random()}`,
          title: "Registry Check",
          status: "draft",
          body: "",
          createdBy: ownerId,
          updatedBy: ownerId,
        }),
      )
      return t.mutation(api.pages.remove, { id })
    },
  },
  // Role-gated only, exactly like `publishPage` — a fixed placeholder
  // `createdBy` is correct here, not an oversight: `unpublish` never
  // checks ownership, so which id "owns" the fixture row is irrelevant to
  // whether this call is allowed.
  {
    name: "pages.unpublish",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const id = await t.run((ctx: any) =>
        ctx.db.insert("pages", {
          slug: `registry-unpublish-${Date.now()}-${Math.random()}`,
          title: "Registry Check",
          status: "published",
          body: "",
          publishedAt: Date.now(),
          createdBy: "registry-check",
          updatedBy: "registry-check",
        }),
      )
      return t.mutation(api.pages.unpublish, { id })
    },
  },
  // Also role-gated only — `mintPreviewToken` reveals nothing an
  // authorized reader couldn't already see via `get`/`list`, so, like
  // `unpublish` above, the fixture's `createdBy` is an arbitrary
  // placeholder, not this role's own id.
  {
    name: "pages.mintPreviewToken",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const id = await t.run((ctx: any) =>
        ctx.db.insert("pages", {
          slug: `registry-preview-${Date.now()}-${Math.random()}`,
          title: "Registry Check",
          status: "draft",
          body: "",
          createdBy: "registry-check",
          updatedBy: "registry-check",
        }),
      )
      return t.mutation(api.pages.mintPreviewToken, { id })
    },
  },
)

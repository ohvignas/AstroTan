import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { roleValidator, pageStatusValidator, outboxStatusValidator } from "./validators"
import { geoValidator, seoValidator } from "./content"

// `seoValidator`/`geoValidator` live in `content.ts`, alongside the length
// bounds Convex's `v.string()` cannot express itself
// (`assertPageTextWithinLimits`), so `pages.create`/`pages.update` import
// the identical validators rather than redeclaring their shape.

export default defineSchema({
  // Pas de champ `role` ici : il vit sur l'utilisateur Better Auth.
  profiles: defineTable({
    authUserId: v.string(),
    displayName: v.string(),
    avatarId: v.optional(v.id("_storage")),
  }).index("by_auth_user", ["authUserId"]),

  invitations: defineTable({
    email: v.string(),
    role: roleValidator,
    tokenHash: v.string(),
    expiresAt: v.number(),
    invitedBy: v.string(),
    acceptedAt: v.optional(v.number()),
    // Staged plaintext token, cleared (patched away) by
    // `internal.invitations.claimPendingToken` the moment the scheduled
    // send job actually runs, and again defensively by `accept` on
    // successful acceptance. Review round 1, I1: the token used to be a
    // scheduled-function *argument* instead, which Convex retains verbatim
    // in the `_scheduled_functions` system table (readable via
    // `ctx.db.system` from any function in the deployment, and visible in
    // the dashboard) for as long as that job record exists — contradicting
    // `lib/token.ts`'s own claim that the plaintext is "never persisted
    // anywhere". Staging it here instead, in a row we control, is what
    // bounds the exposure on the paths this project actually exercises to
    // milliseconds (scheduling to claim) or the time until acceptance.
    //
    // Not an unconditional bound (review round 2, item 3): if the
    // scheduled action fails before its own claim-and-clear mutation call
    // returns, and the invitation is then never accepted or revoked,
    // nothing clears this field — it sits on the row, unreachable through
    // any query (see `invitations.list`), until an operator revokes the
    // invitation (deleting the row) or `expiresAt` passes with nothing
    // acting on it. See `invitations.ts`'s `create` for the full account of
    // what is and isn't actually bounded.
    pendingToken: v.optional(v.string()),
    // The scheduled `sendInvitationEmail` job's own id, so `revoke` can
    // cancel it (M8) rather than letting an already-revoked invitation's
    // email go out after the fact.
    scheduledEmailId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_email", ["email"]),

  // Task 1 of Lot 2: shapes only. Nothing here enforces the lot's
  // invariant ("a draft is visible only to a valid preview-token holder,
  // a published page needs no rebuild") — that's Task 2's public/preview
  // query split. This table just has to make that split easy to write and
  // hard to get wrong: `status` is a closed two-value union a public query
  // can filter on with a plain `.eq`, not a free-form string a filter
  // could silently fail to match.
  pages: defineTable({
    slug: v.string(),
    title: v.string(),
    status: pageStatusValidator,
    // The page's content, as Markdown. A page is text plus settings, not a
    // tree of composable blocks — see `content.ts`'s header for why this
    // template deliberately has no page builder.
    //
    // Required: the expand/migrate/contract cycle that replaced the old
    // `blocks` field is complete (`migrations.ts`'s `blocksToMarkdown`,
    // run against every existing row before this field was tightened and
    // `blocks` dropped from the schema).
    // No content field of any kind, and that is the design: a page's
    // markup is an `.astro` file written in code, and this row carries
    // only what the dashboard is allowed to decide — the slug it answers
    // on, its title, whether it is live, and how it should be found.
    seo: v.optional(seoValidator),
    // Generative Engine Optimization: the abstract, FAQ and entities an
    // answer engine needs to quote the page rather than paraphrase it.
    geo: v.optional(geoValidator),
    publishedAt: v.optional(v.number()),
    // `v.string()`, not `v.id()`: both hold a Better Auth user id, and
    // Better Auth's tables live in a Convex *component* (Local Install,
    // §5) — Convex doesn't type references across that boundary, the same
    // reason `profiles.authUserId` is a bare string. Resolving either to a
    // displayable name goes through `profiles.by_auth_user`.
    createdBy: v.string(),
    updatedBy: v.string(),
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"])
    .index("by_created_by", ["createdBy"]),

  // Métadonnées des fichiers de Convex storage. Table *sidecar* : les
  // champs qui désignent un fichier (`seo.ogImageId`, et le `coverId` des
  // articles) référencent `_storage` directement, et cette table s'y
  // raccroche par `by_storage`. Conséquence assumée : un `storageId` peut
  // exister sans ligne ici — un fichier téléversé hors médiathèque — et
  // c'est un `alt` manquant, jamais une erreur.
  media: defineTable({
    storageId: v.id("_storage"),
    filename: v.string(),
    mime: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    // Obligatoire, jamais optionnel : une image sans alternative textuelle
    // est un défaut d'accessibilité qu'aucune interface ne rattrape, et un
    // champ qu'on peut remplir plus tard n'est jamais rempli.
    alt: v.string(),
    size: v.number(),
    createdBy: v.string(),
  })
    .index("by_storage", ["storageId"])
    .index("by_created_by", ["createdBy"]),

  // Lot 2, Task 3; design spec §6.2 ("Boucle de publication — outbox
  // durable"). Convex does not retry scheduled actions, so a lost
  // invalidation would otherwise leave a page whose `status` says
  // published invisible until its cache `maxAge` expires — with nothing
  // for an operator to look at. `publishPage` inserts a row here in the
  // *same* mutation that flips `pages.status`, which is what makes the
  // row impossible to lose: either both writes land (one Convex
  // transaction) or neither does.
  //
  // `by_status_next_attempt` (compound, in that order) is what lets
  // `revalidate.ts`'s `listDueRows` ask for exactly "pending rows due
  // now" — `.eq("status", "pending").lte("nextAttemptAt", now)` — as a
  // single index range scan, not a full table scan filtered in memory.
  //
  // `pageId` (M4, whole-lot review): optional — additive, per CLAUDE.md's
  // expand/migrate/contract discipline — rather than a required field a
  // schema push against existing rows would reject. Before this field
  // existed, `pages.publicationStatus` had to `.collect()` every row in
  // this *entire* table and filter in memory for `tags.includes(tag)`:
  // correct, but a full-table scan that re-runs on every reactive
  // subscription re-render, and one this table has no bound on (rows are
  // deliberately never deleted — see this table's own header above — so
  // it only ever grows). `by_page_created_at` is what turns "find this
  // page's most recent outbox row" back into a single index range scan:
  // `.withIndex(q => q.eq("pageId", id)).order("desc").first()`. Convex
  // appends `_creationTime` as an implicit final tiebreaker on every
  // index (confirmed against `convex`'s own `system_fields.d.ts`), which
  // is also what fixes the old strict-`>` reduce's tie-losing bug for
  // free: two rows inserted in the same millisecond are still ordered
  // correctly by insertion order, not just left to whichever the JS
  // reduce happened to see first.
  revalidationOutbox: defineTable({
    tags: v.array(v.string()),
    pageId: v.optional(v.id("pages")),
    status: outboxStatusValidator,
    attempts: v.number(),
    nextAttemptAt: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_status_next_attempt", ["status", "nextAttemptAt"])
    .index("by_page_created_at", ["pageId", "createdAt"]),
})

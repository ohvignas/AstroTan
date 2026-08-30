import { v } from "convex/values"
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { deriverOrigines } from "./lib/origines"

// Design spec §6.2 — the outbox drain loop. Convex does not retry
// scheduled actions, so `publishPage` (`convex/pages.ts`) writes a
// `revalidationOutbox` row in the *same* mutation that flips a page's
// status (see `schema.ts`'s comment on the table). This module is
// everything downstream of that row: the atomic insert helper the
// mutation calls, and the drain loop — scheduled immediately by
// `publishPage` for the fast path, and swept every 60s by `crons.ts` as
// the recovery path for a job that never ran at all.

// ---------------------------------------------------------------------
// Backoff schedule (design spec §6.2, verbatim): 1s, 5s, 25s, 2min,
// 10min — indexed by `attempts` *after* increment, so the first failure
// (attempts: 0 -> 1) waits 1s, the second (1 -> 2) waits 5s, and so on.
// The 6th failure (attempts: 5 -> 6) has no entry left: that's the
// terminal "failed" case, not a 6th backoff.
// ---------------------------------------------------------------------
const BACKOFF_MS = [1_000, 5_000, 25_000, 2 * 60_000, 10 * 60_000]
const MAX_ATTEMPTS = 6

// An HMAC-strength secret is table stakes for a header a public endpoint
// trusts unconditionally (`apps/web`'s `/api/revalidate`, Task 7) — same
// floor as `lib/previewToken.ts`'s `PREVIEW_SECRET`. Read at the point of
// use, not cached at module load or threaded in from a caller: the only
// realistic caller is `drain` itself, so there is no "shape now, guard
// later" split worth making (same reasoning as `previewToken.ts`'s own
// `getPreviewSecret`).
const MIN_REVALIDATE_SECRET_LENGTH = 32

function getRevalidateSecret(): string {
  const secret = process.env.REVALIDATE_SECRET
  if (!secret) {
    throw new Error("REVALIDATE_SECRET is not set on this Convex deployment")
  }
  if (secret.length < MIN_REVALIDATE_SECRET_LENGTH) {
    throw new Error(`REVALIDATE_SECRET must be at least ${MIN_REVALIDATE_SECRET_LENGTH} characters`)
  }
  return secret
}

// `WEB_SITE_URL` is `apps/web`'s own public origin — deliberately a
// *different* variable from `SITE_URL` (`auth.ts`'s `baseURL`,
// `invitations.ts`'s accept-invite link): that one is already load-bearing
// for Better Auth and is documented (`.env.example`) as "the site that
// owns the Better Auth session", i.e. `apps/admin`. `/api/revalidate`
// (Task 7) lives on `apps/web`, a different origin entirely — reusing
// `SITE_URL` for this would make either Better Auth's `baseURL` or this
// POST target the wrong app, silently, depending on which origin an
// operator happened to configure it with. Same discipline as every other
// secret/URL in this codebase either way: absence must throw, never
// silently no-op. Read inside `drain`, not here, since it's only needed
// once per invocation and the failure needs to surface as *that action's*
// failure.

// ---------------------------------------------------------------------
// Called from `pages.publishPage`'s own mutation body — a plain
// `ctx.db.insert`, not a separate mutation of its own, so it runs inside
// the caller's transaction. That's what makes the outbox row impossible
// to lose: either it commits alongside the page's `status` write, or
// neither commits at all. `nextAttemptAt: now` means the row is
// immediately due — `publishPage` also schedules `drain` for `now`
// itself (the fast path), but the row would still be picked up by the
// next cron sweep even if that scheduled call were somehow lost.
// ---------------------------------------------------------------------
// `pageId` (M4, whole-lot review): threaded through from every caller so
// `pages.publicationStatus` can look a page's most recent outbox row up
// by a single index equality clause (`schema.ts`'s own comment on
// `by_page_created_at`) instead of scanning and filtering this whole,
// never-reaped table. Optional, matching the schema field itself — a row
// this module ever inserts always has a real page behind it in practice,
// but the type stays honest about what the schema actually guarantees.
/**
 * What a row is about, so a page's own bookkeeping never has to read a
 * post's rows.
 *
 * `pages.publicationStatus` falls back to scanning rows with no `pageId`,
 * and its whole cost argument is that this set can only shrink — every
 * caller passes a real id. Posts publish through the same outbox and have
 * no `pageId`, so without this discriminant that set would grow by one row
 * per post publish, forever, on a query the editor screen subscribes to
 * reactively. `kind` is what keeps the two apart at the index, not in
 * memory after the fact.
 *
 * Optional in the schema: rows written before this field existed carry
 * none, and `kind === undefined` is exactly the frozen legacy set that
 * fallback now scans.
 */
export type OutboxTarget =
  | { kind: "page"; pageId: Id<"pages"> | undefined }
  | { kind: "post"; postId: Id<"posts"> }

export async function insertOutboxRow(
  ctx: MutationCtx,
  target: OutboxTarget,
  tags: string[],
): Promise<void> {
  const now = Date.now()
  await ctx.db.insert("revalidationOutbox", {
    tags,
    kind: target.kind,
    pageId: target.kind === "page" ? target.pageId : undefined,
    postId: target.kind === "post" ? target.postId : undefined,
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
  })
}

// Read-only half of "claim the due rows": an index range scan on
// `by_status_next_attempt`, not a full-table `.filter` — the row count
// here is expected to stay small (one per publish, cleared to `done`
// within seconds), but the shape is what makes that true rather than
// merely convenient once it isn't.
export const listDueRows = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    return ctx.db
      .query("revalidationOutbox")
      .withIndex("by_status_next_attempt", (q) => q.eq("status", "pending").lte("nextAttemptAt", now))
      .collect()
  },
})

// Claim step (Low, whole-lot review): without this, two concurrent
// `drain` calls — the fast-path `runAfter(0, ...)` from a mutation and
// the 60s cron sweep, or two overlapping cron ticks under a slow HTTP
// call — could both `listDueRows` the same still-`pending` row before
// either has recorded an outcome, then both call `markAttemptFailed` (or
// one `markDone` racing one `markAttemptFailed`) for the same underlying
// attempt, double-incrementing `attempts` for a single real failure. The
// six-attempt budget (`MAX_ATTEMPTS`, this module's own header comment)
// is meant to bound six real delivery attempts, not silently become
// three under contention.
//
// A single `ctx.db.patch` inside one mutation call is what makes the
// claim atomic: Convex's OCC tracks every document a mutation reads, so
// if two `claimRow` calls race on the same row, the second one to commit
// is transparently retried against the *post-first-claim* document —
// its own `row.nextAttemptAt > now` check then sees the bumped value and
// returns `false`, never reaching the `ctx.db.patch` a second time. No
// new `status` value is introduced (an additive schema change is still a
// schema change — see `schema.ts`'s own expand/migrate/contract
// discipline): the row stays `"pending"`, just not *due* again until
// `CLAIM_HOLD_MS` from now — self-healing if the claiming `drain` call
// itself crashes mid-flight, since the row becomes due again on its own
// rather than staying claimed forever.
// Closing-fixes review: the old comment ("short enough that a crashed
// `drain` doesn't strand a row past the next 60s cron sweep") was false
// for its own 2-minute value — 2 minutes is *twice* the 60s cron interval
// (`crons.ts`), so a crashed `drain` was stranding a claimed row past two
// sweeps, not zero. Worse, the hold bounded nothing at all in practice:
// `drain`'s own `fetch` call had no `AbortSignal`, so a connection that
// merely stalled (never actually crashing the action) could run past
// `CLAIM_HOLD_MS` on its own, and the next sweep would re-claim the same
// row and re-attempt delivery — reproducing exactly the double-attempt
// the claim step (`claimRow`, above) exists to prevent.
//
// The fix is two numbers that have to satisfy one inequality, checked
// here rather than only asserted: `FETCH_TIMEOUT_MS` (15s) + one mutation
// round trip (`ctx.runMutation`, single-digit milliseconds in practice)
// must stay comfortably under `CLAIM_HOLD_MS` (30s), which must itself
// stay under the 60s cron interval — 15s + a few ms << 30s < 60s. That
// ordering is what makes the comment true again: `drain` now always
// either finishes (success or a bounded 15s timeout counted as a
// failure) or is genuinely killed outright well before the next sweep
// could possibly re-claim the same row while it's still in flight.
const FETCH_TIMEOUT_MS = 15_000
const CLAIM_HOLD_MS = 30_000

export const claimRow = internalMutation({
  args: { id: v.id("revalidationOutbox") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row || row.status !== "pending") return false
    const now = Date.now()
    // Already claimed by a concurrent `drain` call (or genuinely not due
    // yet, though `listDueRows` shouldn't have returned it in that case).
    if (row.nextAttemptAt > now) return false
    await ctx.db.patch(args.id, { nextAttemptAt: now + CLAIM_HOLD_MS })
    return true
  },
})

// `if (!row) return` / `if (row.status !== "pending") return`: both are
// "nothing to do", not "something went wrong" — a row can vanish (none of
// this lot's mutations delete one, but nothing here should assume that
// stays true forever) or have already reached a terminal state by the
// time this runs. Neither case should resurrect a `done`/`failed` row or
// throw over something that isn't actually an error from the caller's
// point of view.
export const markDone = internalMutation({
  args: { id: v.id("revalidationOutbox") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row || row.status !== "pending") return
    await ctx.db.patch(args.id, { status: "done" })
  },
})

// Same "nothing to do, not an error" guard as `markDone` above. The
// backoff/terminal decision itself: `attempts` is read *before* this
// call's own increment, so `BACKOFF_MS[attempts]` (0-indexed, matching
// this module's own header comment: attempts 0->1 is the first failure)
// is the delay for the failure this call is recording. Once `attempts`
// reaches `MAX_ATTEMPTS` (6), there is no further backoff — the row
// becomes `failed`, the terminal state design spec §6.2 defines for "six
// échecs".
export const markAttemptFailed = internalMutation({
  args: { id: v.id("revalidationOutbox"), error: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id)
    if (!row || row.status !== "pending") return
    const attempts = row.attempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(args.id, { status: "failed", attempts, lastError: args.error })
      return
    }
    // `attempts` is always 1..(MAX_ATTEMPTS - 1) here (the `>= MAX_ATTEMPTS`
    // branch above already returned), so `attempts - 1` is always a valid
    // `BACKOFF_MS` index in practice — the `?? 600_000` fallback exists
    // only to satisfy `noUncheckedIndexedAccess`, not because this path is
    // reachable; `600_000` mirrors `BACKOFF_MS`'s own last entry (10min)
    // rather than inventing an unrelated number.
    const delay = BACKOFF_MS[attempts - 1] ?? 600_000
    await ctx.db.patch(args.id, {
      attempts,
      nextAttemptAt: Date.now() + delay,
      lastError: args.error,
    })
  },
})

// The drain loop itself. An `internalAction`, not a mutation: it performs
// real network I/O (`fetch`), which mutations cannot do at all — so its
// reads and writes go through `ctx.runQuery`/`ctx.runMutation` instead of
// `ctx.db` directly, each its own separate transaction. That means a
// single `drain` call claiming several due rows is not one atomic unit —
// a crash partway through leaves the rows already processed `done`/
// backed-off and the rest still `pending`, which is exactly the recovery
// shape this whole design accepts: the next scheduled or cron-swept
// `drain` call picks up whatever is still due, because claiming is a
// query on `status`/`nextAttemptAt`, not tied to which invocation
// scheduled it (see `crons.ts`'s own header for the "lost job" case this
// is built to survive).
//
// `WEB_SITE_URL`/`REVALIDATE_SECRET` are both checked *before* touching
// any row: a deployment missing either is a configuration error, not
// something any individual outbox row did wrong, so it must surface as
// this action failing outright (visible as a failed scheduled function in
// the Convex dashboard — same shape as `invitations.ts`'s own `SITE_URL`
// guard) rather than silently burning through a row's 6-attempt budget on
// every sweep until someone notices.
export const drain = internalAction({
  args: {},
  handler: async (ctx) => {
    // L'origine du site public suit le domaine déclaré depuis
    // `/settings/domaine` quand il est posé (`lib/origines.ts`), et
    // retombe sur `WEB_SITE_URL` sinon. Pointée vers l'ancien domaine,
    // cette invalidation part sur un hôte que Traefik ne route plus : les
    // pages du NOUVEAU domaine garderaient leur cache indéfiniment.
    const { web: siteUrl } = deriverOrigines(
      await ctx.runQuery(internal.settings.domaineDeclare, {}),
    )
    if (!siteUrl) throw new Error("WEB_SITE_URL is not set on this Convex deployment")
    const secret = getRevalidateSecret()

    const rows = await ctx.runQuery(internal.revalidate.listDueRows, {})

    for (const row of rows) {
      const claimed = await ctx.runMutation(internal.revalidate.claimRow, { id: row._id })
      if (!claimed) continue // Already claimed by a concurrent `drain` invocation — see `claimRow`'s own header.

      try {
        const response = await fetch(`${siteUrl}/api/revalidate`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-revalidate-secret": secret,
          },
          body: JSON.stringify({ tags: row.tags }),
          // Bounds this call to `FETCH_TIMEOUT_MS` (see `CLAIM_HOLD_MS`'s
          // own header comment for the ordering this depends on) — a
          // stalled-but-not-dead connection must not be allowed to run
          // past the claim hold, or the next cron sweep re-claims and
          // re-attempts the same row while this call is still in flight.
          // The resulting `TimeoutError` is thrown, not returned, so it
          // falls straight into the `catch` block below — treated exactly
          // like any other network failure.
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!response.ok) {
          await ctx.runMutation(internal.revalidate.markAttemptFailed, {
            id: row._id,
            error: `HTTP ${response.status}`,
          })
          continue
        }
        await ctx.runMutation(internal.revalidate.markDone, { id: row._id })
      } catch (err) {
        // A thrown `fetch` (network error, DNS failure, ...) is exactly
        // as much "the invalidation didn't happen" as a non-2xx response
        // — both must increment `attempts` and reschedule, never leave
        // the row silently `pending` with no error and no next attempt.
        await ctx.runMutation(internal.revalidate.markAttemptFailed, {
          id: row._id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  },
})

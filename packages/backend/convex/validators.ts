import { v } from "convex/values"

/**
 * Upper bound on `profiles.displayName`, and on every value that becomes
 * one — the pseudo chosen at `invitations.accept`, the email an invitation
 * is issued to. Lives here rather than in `profiles.ts` so the browser form
 * can set its input's `maxLength` from the same number the mutations
 * enforce; `profiles.ts` re-exports it for its existing importers.
 */
export const MAX_DISPLAY_NAME_LENGTH = 100
export const roleValidator = v.union(
  v.literal("owner"), v.literal("admin"), v.literal("editor"),
)
export type Role = "owner" | "admin" | "editor"

const ROLES: readonly Role[] = ["owner", "admin", "editor"]

// `role` arrives as `string | null | undefined` from Better Auth: its
// schema doesn't constrain it (`v.optional(v.union(v.null(), v.string()))`),
// and a value like `"owner,editor"` (better-auth joins a multi-role
// `set-role` request into one comma-separated string before it ever
// reaches an adapter or a hook) is a `string` too. Validate explicitly
// rather than casting — a cast (`authUser.role as Role`) would lie about
// what the data actually guarantees, and this must return `null` (not a
// permissive default) for anything that isn't *exactly* one known role, so
// every caller fails closed on the same input the same way.
//
// Lives here rather than in `lib/authz.ts` (which used to own it) so both
// `lib/authz.ts` and `lib/ownerGuard.ts` — and `auth.ts`, which needs it
// for the `databaseHooks` wiring — can import it without `auth.ts` having
// to import `lib/authz.ts`, which itself imports `authComponent` from
// `auth.ts`. That was a real circular import (harmless in practice, since
// neither side dereferences the other at module-evaluation time, but not
// worth the risk once a second consumer needed it too).
export function parseRole(raw: unknown): Role | null {
  return typeof raw === "string" && (ROLES as readonly string[]).includes(raw)
    ? (raw as Role)
    : null
}

// `pages.status` (Lot 2). No revisions in v1 (design spec §4): a page is
// either a `draft` only its author and preview-token holders can see, or
// `published` and served by the public queries — nothing in between. Same
// shape as `roleValidator` above: a closed `v.union` of `v.literal`s, so
// Convex itself rejects any other string rather than silently accepting
// it as an untyped status the renderer or the public-query filter (Task 2)
// wouldn't recognize.
export const pageStatusValidator = v.union(v.literal("draft"), v.literal("published"))
export type PageStatus = "draft" | "published"

// `revalidationOutbox.status` (Lot 2, Task 3; design spec §6.2). Same
// closed-union discipline as the two validators above: `drain`
// (`convex/revalidate.ts`) filters on this with a plain `.eq` via the
// `by_status_next_attempt` index, so a value outside these three literals
// would either silently never match that filter or — worse — match it by
// accident if the index clause were ever loosened to a variable.
export const outboxStatusValidator = v.union(
  v.literal("pending"),
  v.literal("done"),
  v.literal("failed"),
)
export type OutboxStatus = "pending" | "done" | "failed"

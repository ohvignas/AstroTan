import { v } from "convex/values"
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

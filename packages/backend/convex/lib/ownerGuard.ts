import { parseRole } from "../validators"

export type OwnerInvariantInput = {
  operation: "update" | "delete"
  actorId: string
  // Raw, unvalidated — exactly what a Better Auth session's `user.role`
  // is: `string | null | undefined`, and a caller could hand us anything.
  // Parsed internally (fail closed) rather than trusted as `Role`, so an
  // unidentifiable actor is never silently treated as "not the owner" by
  // a caller-side default — see the FORBIDDEN check below.
  actorRole: unknown
  targetId: string
  // Same: the row's *current* role, unvalidated.
  targetRole: unknown
  // The row's role *after* the write. Only consulted when
  // `operation === "update"` — a deletion never "survives" with a role,
  // so it must never be expressible by threading a role-shaped value
  // through here. (It used to be `Role | null` with `null` meaning
  // "this is a deletion" — that collapsed onto the exact same value an
  // *unparseable* incoming role produced, so a multi-role update like
  // `"owner,editor"` silently read as "no role change" instead of being
  // refused. `operation` now carries that distinction explicitly.)
  nextRole: unknown
  ownerCount: number
}

export class OwnerInvariantError extends Error {}

export function assertOwnerInvariant(i: OwnerInvariantInput): void {
  // Fail closed on the *target's* current role: a row whose role cannot
  // be classified — missing, null, or some value outside the three known
  // roles — must never be treated as "safely not the owner". Defaulting
  // an unclassifiable stored role to e.g. `"editor"` is exactly the kind
  // of permissive default that let a bug through review once already; see
  // the task report's C1 for the incident this guards against.
  const targetRole = parseRole(i.targetRole)
  if (targetRole === null) {
    throw new OwnerInvariantError(
      "UNCLASSIFIABLE_TARGET_ROLE: le rôle actuel de la cible est inconnu, absent ou multiple",
    )
  }

  // An actor whose role can't be classified (no session, or a role that
  // doesn't parse to exactly one known value — including a multi-role
  // string like `"owner,editor"`) is never treated as the owner:
  // `actorRole !== "owner"` reads `true` either way, which is the side we
  // want it to fail on.
  const actorRole = parseRole(i.actorRole)

  // "Only the owner may modify the owner" — checked two ways, not one.
  // `actorId !== targetId` alone would say nothing if `actorId` were ever
  // derived incorrectly upstream (a bug, not an attack) and happened to
  // equal `targetId`; `actorRole !== "owner"` alone would say nothing if
  // this invariant were ever (bug, again) evaluated before the single
  // -owner property actually held, i.e. with more than one owner row in
  // existence, since two different owners would each satisfy
  // `actorRole === "owner"` without being the *same* owner. Requiring
  // both closes either gap independently of the other.
  if (targetRole === "owner" && (i.actorId !== i.targetId || actorRole !== "owner")) {
    throw new OwnerInvariantError("FORBIDDEN: seul un owner peut se modifier lui-même")
  }

  if (i.operation === "delete") {
    // A delete never "survives" as owner — there is no row left to hold
    // the role afterwards, so the only question is whether the row being
    // removed was the last owner.
    if (targetRole === "owner" && i.ownerCount <= 1) {
      throw new OwnerInvariantError(
        "LAST_OWNER: le dernier owner ne peut être ni rétrogradé ni supprimé",
      )
    }
    return
  }

  // operation === "update": fail closed on the *incoming* role the same
  // way as the target's. `String(...).split(",")` mirrors better-auth's
  // own `parseRoles`/`hasPermission`, which join an array role into
  // `"owner,editor"` and then grant access if *any* joined component
  // matches — so a value with more than one component, or a single
  // component that isn't a known role, must be refused outright, not
  // coerced into "no role change" (that coercion is exactly what let a
  // `role: ["owner","editor"]` request through undetected before this
  // fix — see the task report's C1).
  const nextRole = parseRole(i.nextRole)
  if (nextRole === null) {
    throw new OwnerInvariantError(
      "INVALID_ROLE: le rôle demandé est inconnu, absent ou multiple",
    )
  }

  if (nextRole === "owner" && targetRole !== "owner") {
    throw new OwnerInvariantError("OWNER_ALREADY_EXISTS: un seul owner est autorisé")
  }
  if (targetRole === "owner" && nextRole !== "owner" && i.ownerCount <= 1) {
    throw new OwnerInvariantError(
      "LAST_OWNER: le dernier owner ne peut être ni rétrogradé ni supprimé",
    )
  }
}

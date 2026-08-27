import type { Role } from "../validators"

export type OwnerInvariantInput = {
  actorId: string
  actorRole: Role
  targetId: string
  targetRole: Role
  nextRole: Role | null // null = suppression
  ownerCount: number
}

export class OwnerInvariantError extends Error {}

export function assertOwnerInvariant(i: OwnerInvariantInput): void {
  if (i.targetRole === "owner" && i.actorId !== i.targetId) {
    throw new OwnerInvariantError("FORBIDDEN: seul un owner peut se modifier lui-même")
  }
  if (i.nextRole === "owner" && i.targetRole !== "owner") {
    throw new OwnerInvariantError("OWNER_ALREADY_EXISTS: un seul owner est autorisé")
  }
  if (i.targetRole === "owner" && i.nextRole !== "owner" && i.ownerCount <= 1) {
    throw new OwnerInvariantError("LAST_OWNER: le dernier owner ne peut être ni rétrogradé ni supprimé")
  }
}

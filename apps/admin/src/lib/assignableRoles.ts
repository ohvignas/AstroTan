export function assignableRoles(
  actorRole: "owner" | "admin" | "editor"
): Record<string, string> {
  if (actorRole === "owner") {
    return { admin: "Administrateur", editor: "Éditeur" }
  }
  return { editor: "Éditeur" }
}

export function canEditTargetRole(
  actorRole: "owner" | "admin" | "editor",
  targetRole: "owner" | "admin" | "editor" | null
): boolean {
  if (targetRole === null || targetRole === "owner") return false
  if (actorRole === "owner")
    return targetRole === "admin" || targetRole === "editor"
  return targetRole === "editor"
}

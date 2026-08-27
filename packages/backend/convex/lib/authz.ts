import { ConvexError } from "convex/values"
import { authComponent } from "../auth"
import type { Role } from "../validators"

const ROLES: readonly Role[] = ["owner", "admin", "editor"]

// `role` arrive en `string | null | undefined` : le schéma Better Auth ne le
// contraint pas (`v.optional(v.union(v.null(), v.string()))`). On valide
// explicitement plutôt que de caster — un cast (`authUser.role as Role`)
// mentirait sur ce que la donnée garantit réellement.
export function parseRole(raw: unknown): Role | null {
  return typeof raw === "string" && (ROLES as readonly string[]).includes(raw)
    ? (raw as Role)
    : null
}

// Le plugin `admin()` pose `banned`/`banReason`/`banExpires` sur
// l'utilisateur Better Auth, et les endpoints de ban sont ouverts à owner
// et admin. Sans vérification côté lecture, bannir quelqu'un n'empêcherait
// rien : le ban serait décoratif. Un ban sans `banExpires` est permanent ;
// un ban dont `banExpires` est déjà passé n'est plus actif.
export function isCurrentlyBanned(authUser: {
  banned?: boolean | null
  banExpires?: number | null
}): boolean {
  if (!authUser.banned) return false
  if (authUser.banExpires == null) return true
  return authUser.banExpires > Date.now()
}

// On lit le rôle via `authComponent.getAuthUser(ctx)`, pas via
// `ctx.auth.getUserIdentity()` : le plugin `convex()` embarque `role` et
// `banned` dans le token d'identité Convex, avec une expiration par défaut
// de 15 minutes. Lire les claims du token laisserait une rétrogradation ou
// un ban sans effet jusqu'à 15 minutes. Passer par l'utilisateur Better
// Auth applique le changement dès le prochain appel.
export async function requireRole(ctx: any, roles: Role[]) {
  const authUser = await authComponent.getAuthUser(ctx)
  // `getAuthUser` lève déjà (`ConvexError("Unauthenticated")`) plutôt que
  // de renvoyer une valeur fausse quand personne n'est authentifié — ce
  // garde reste en défense en profondeur si ce comportement changeait.
  if (!authUser) throw new ConvexError({ code: "UNAUTHENTICATED" })

  if (isCurrentlyBanned(authUser)) throw new ConvexError({ code: "BANNED" })

  // null couvre trois cas : rôle absent, null, ou valeur inconnue
  // ("superadmin"). Tous échouent fermé.
  const role = parseRole(authUser.role)
  if (!role || !roles.includes(role)) throw new ConvexError({ code: "FORBIDDEN" })

  return { ...authUser, role }
}

// Un editor n'écrit que ses propres documents. requireRole ne suffit pas :
// il vérifie le rôle, pas la propriété du document.
export function requireOwnDocument(
  authUser: { _id: string; role: string },
  doc: { createdBy: string },
) {
  if (authUser.role === "editor" && doc.createdBy !== authUser._id) {
    throw new ConvexError({ code: "FORBIDDEN" })
  }
}

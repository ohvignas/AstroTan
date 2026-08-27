import { ConvexError } from "convex/values"
import type { GenericCtx } from "@convex-dev/better-auth"
import { authComponent } from "../auth"
import type { DataModel } from "../_generated/dataModel"
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
// un ban dont `banExpires` est déjà passé n'est plus actif. `>=` (pas `>`)
// pour matcher le plugin admin lui-même, qui traite `banExpires === now`
// comme encore banni.
export function isCurrentlyBanned(authUser: {
  banned?: boolean | null
  banExpires?: number | null
}): boolean {
  if (!authUser.banned) return false
  if (authUser.banExpires == null) return true
  return authUser.banExpires >= Date.now()
}

// Compose les trois vérifications d'accès en une seule décision pure, pour
// que la composition elle-même — pas seulement chaque primitive prise
// isolément — soit directement testable : l'ordre (un owner banni doit
// recevoir BANNED, pas FORBIDDEN) et le fait que supprimer une des trois
// vérifications fasse échouer un test plutôt que de passer silencieusement.
export function decideAccess(
  authUser:
    | { role?: string | null; banned?: boolean | null; banExpires?: number | null }
    | null
    | undefined,
  roles: Role[],
): Role {
  if (!authUser) throw new ConvexError({ code: "UNAUTHENTICATED" })

  // Champs touchés explicitement (pas un simple passage de `authUser`) :
  // si `betterAuth/schema.ts` était régénéré sans `banned`/`banExpires` (un
  // changement de plugin, un renommage), cet accès de propriété cesserait
  // de typechecker au lieu de laisser le ban devenir silencieusement
  // décoratif.
  if (isCurrentlyBanned({ banned: authUser.banned, banExpires: authUser.banExpires })) {
    throw new ConvexError({ code: "BANNED" })
  }

  // null couvre trois cas : rôle absent, null, ou valeur inconnue
  // ("superadmin"). Tous échouent fermé.
  const role = parseRole(authUser.role)
  if (!role || !roles.includes(role)) throw new ConvexError({ code: "FORBIDDEN" })

  return role
}

// On lit le rôle via `authComponent.safeGetAuthUser(ctx)`, pas via
// `ctx.auth.getUserIdentity()` : le plugin `convex()` embarque `role` et
// `banned` dans le token d'identité Convex, avec une expiration par défaut
// de 15 minutes. Lire les claims du token laisserait une rétrogradation ou
// un ban sans effet jusqu'à 15 minutes. Passer par l'utilisateur Better
// Auth applique le changement dès le prochain appel.
//
// `safeGetAuthUser` (pas `getAuthUser`) : `getAuthUser` lève lui-même
// `ConvexError("Unauthenticated")` — une chaîne, pas notre forme
// `{ code }` — dès que l'identité, la session ou la ligne utilisateur
// manque, ce qui empêcherait un appelant de brancher uniformément sur
// `error.data.code` (`FORBIDDEN`/`BANNED` arrivent bien sous cette forme,
// `UNAUTHENTICATED` non). `safeGetAuthUser` renvoie `undefined` dans ces
// trois cas à la place, laissant `decideAccess` lever notre propre
// `{ code: "UNAUTHENTICATED" }`.
export async function requireRole(ctx: GenericCtx<DataModel>, roles: Role[]) {
  const authUser = await authComponent.safeGetAuthUser(ctx)
  const role = decideAccess(authUser, roles)
  // `decideAccess` lève avant de renvoyer si `authUser` est absent — cette
  // vérification documente cet invariant pour le vérificateur de types,
  // ce n'est pas un nouveau contrôle à l'exécution.
  if (!authUser) throw new ConvexError({ code: "UNAUTHENTICATED" })

  // On ne renvoie que ce dont les mutations ont besoin, pas le document
  // Better Auth complet : celui-ci porte aussi `banReason`, `image`,
  // `emailVerified`, etc. — le spread aurait mis ces champs à un pas de
  // fuiter vers un client via n'importe quelle mutation qui retourne son
  // `authUser`.
  return { _id: authUser._id, role, email: authUser.email }
}

// Un editor n'écrit que ses propres documents ; owner et admin contournent
// la vérification de propriété. Liste d'autorisation (pas une liste de
// blocage sur `"editor"`) : un futur quatrième rôle sans entrée explicite
// ici est refusé par défaut plutôt que de silencieusement hériter d'un
// accès en écriture sur tous les documents.
const OWNERSHIP_BYPASS: readonly Role[] = ["owner", "admin"]

export function requireOwnDocument(
  authUser: { _id: string; role: Role },
  doc: { createdBy: string },
) {
  if (OWNERSHIP_BYPASS.includes(authUser.role)) return
  if (typeof doc.createdBy !== "string" || doc.createdBy !== authUser._id) {
    throw new ConvexError({ code: "FORBIDDEN" })
  }
}

import { ConvexError } from "convex/values"
import type { GenericCtx } from "@convex-dev/better-auth"
import { authComponent } from "../auth"
import type { DataModel } from "../_generated/dataModel"
import type { Role } from "../validators"
import { parseRole } from "../validators"

// Re-exported for backward compatibility (existing imports of `parseRole`
// from this module, e.g. `authz.test.ts`) — the implementation itself now
// lives in `../validators`, see the comment there for why.
export { parseRole }

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

// Claims que le plugin `convex()` pose sur le jeton (`omit(user)` hors
// `id`/`image`, plus `sessionId`). `UserIdentity` de Convex ne les type
// pas : on les lit ici, au seul point qui s'en sert.
type IdentityClaims = {
  role?: string | null
  banned?: boolean | null
  banExpires?: number | null
  email?: string | null
}

/**
 * Même décision que `requireRole`, sans hop vers le composant Better Auth.
 *
 * `safeGetAuthUser` fait deux `ctx.runQuery` dans le composant (session,
 * puis user). Ces lectures ont le plafond d'une *query* Convex — 1 s —
 * même quand l'appelant est une mutation. `marquerVu` tombait là-dessus
 * à l'ouverture d'une fiche.
 *
 * Le jeton porte déjà `role` et `banned` (plugin `convex()`, 15 min).
 * Pour une écriture anodine — poser `seenAt` — ce décalage est acceptable.
 * Les mutations qui changent un rôle, un ban ou une ressource d'autrui
 * restent sur `requireRole`.
 */
export async function requireRoleFromIdentity(ctx: GenericCtx<DataModel>, roles: Role[]) {
  const identity = await ctx.auth.getUserIdentity()
  const claims = (identity ?? {}) as IdentityClaims
  const role = decideAccess(
    identity
      ? { role: claims.role, banned: claims.banned, banExpires: claims.banExpires }
      : null,
    roles,
  )
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" })
  return { _id: identity.subject, role, email: claims.email ?? identity.email ?? "" }
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

// H1 bis (closing fixes, whole-lot re-review): `requireOwnDocument` alone
// lets `pages.update`/`pages.remove` compose into a public-content bypass
// — `publishPage` gates on role, not ownership, so once any owner/admin
// has published a page whose `createdBy` happens to be a given editor,
// that editor's normal "write my own document" access reaches straight
// into the live, publicly served row (or lets them delete it outright,
// turning a live URL into a 404 — `pages.remove`'s own case). The original
// guard (`pages.ts`) named the *refused* role directly
// (`authUser.role === "editor" && ...`) — a deny-list on one literal role,
// unlike `OWNERSHIP_BYPASS` just above, which is this file's own
// convention for exactly this shape of decision: an allow-list, so a
// fourth role added to some future `requireRole([...])` call inherits
// *nothing* here by default, rather than silently inheriting the right to
// rewrite or delete a published page because it happens not to be spelled
// "editor".
const PUBLISHED_PAGE_WRITE_ALLOWED: readonly Role[] = ["owner", "admin"]

export function requirePublishedPageWritable(
  authUser: { role: Role },
  page: { status: string },
) {
  if (page.status !== "published") return
  if (PUBLISHED_PAGE_WRITE_ALLOWED.includes(authUser.role)) return
  throw new ConvexError({ code: "FORBIDDEN" })
}

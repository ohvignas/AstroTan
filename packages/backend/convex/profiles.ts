import { ConvexError, v } from "convex/values"
import { internalMutation, mutation, query } from "./_generated/server"
import { api } from "./_generated/api"
import { requireRole } from "./lib/authz"
import { MUTATION_REGISTRY } from "./_registry"

export const MAX_DISPLAY_NAME_LENGTH = 100

// Seule source de vérité pour "un profil par utilisateur, jamais deux" :
// idempotente par construction (`.unique()` sur `by_auth_user` lèverait si
// un doublon existait déjà, donc "déjà présent -> ne rien refaire" est
// aussi ce qui empêche ce doublon d'exister en premier lieu). `onCreate`
// (`auth.ts`) délègue ici plutôt que de réinsérer directement, pour ne pas
// dupliquer cette logique dans deux endroits qui pourraient diverger — le
// hook peut rejouer, et c'est exactement le scénario que cette fonction
// doit absorber sans jamais produire un second profil.
export const ensure = internalMutation({
  args: { authUserId: v.string(), displayName: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", args.authUserId))
      .unique()
    if (existing) return existing._id
    return ctx.db.insert("profiles", args)
  },
})

// Le rôle n'est jamais lu depuis `profiles` (qui n'a pas ce champ) : il est
// recomposé ici, à la lecture, depuis l'utilisateur Better Auth authentifié
// via `requireRole`. `profiles` ne porte que ce que Better Auth ne porte
// pas déjà (displayName, avatarId).
//
// Lève NOT_FOUND si le profil est introuvable plutôt que de renvoyer un
// objet partiel : `{ ...null, role, email }` vaut `{ role, email }` (JS
// autorise l'étalement de `null`, silencieusement), donc sans ce garde un
// utilisateur dont le profil manque recevrait un 200 qui rapporte
// l'invariant "un profil par utilisateur" comme respecté alors qu'il ne
// l'est pas. `onUpdate` (`auth.ts`) répare un profil manquant à la
// prochaine écriture Better Auth sur cet utilisateur ; ce garde couvre la
// fenêtre avant cette réparation.
export const me = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", authUser._id))
      .unique()
    if (!profile) throw new ConvexError({ code: "NOT_FOUND" })
    return { ...profile, role: authUser.role, email: authUser.email }
  },
})

// Modifie uniquement le profil de l'appelant : aucun paramètre ne désigne
// un profil ou un utilisateur cible, donc il n'existe structurellement
// aucune façon de passer l'id de quelqu'un d'autre ici — le profil à
// modifier est systématiquement recherché via l'`authUserId` de
// l'appelant, jamais reçu en argument. C'est cette absence de paramètre
// cible, pas une vérification a posteriori, qui garantit qu'un admin ne
// peut pas éditer le profil de quelqu'un d'autre par ce chemin (il passe
// par l'écran de gestion des utilisateurs, Task 10, à la place).
export const updateMine = mutation({
  args: {
    displayName: v.optional(v.string()),
    avatarId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", authUser._id))
      .unique()
    if (!profile) throw new ConvexError({ code: "NOT_FOUND" })

    const patch: { displayName?: string; avatarId?: typeof args.avatarId } = {}
    if (args.displayName !== undefined) {
      const trimmed = args.displayName.trim()
      if (trimmed.length === 0 || trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
        throw new ConvexError({ code: "INVALID_DISPLAY_NAME" })
      }
      patch.displayName = trimmed
    }
    if (args.avatarId !== undefined) patch.avatarId = args.avatarId
    await ctx.db.patch(profile._id, patch)
    return profile._id
  },
})

// Requis par le test d'exhaustivité de `_registry.test.ts` : toute
// mutation publique doit être déclarée ici. `updateMine` autorise les
// trois rôles (owner/admin/editor) — c'est `requireRole` dans le handler
// ci-dessus qui l'impose, pas ce registre, mais le registre doit le
// refléter.
//
// `invoke` appelle la mutation réelle telle quelle. Ce registre est
// partagé avec `convex/lib/authz.test.ts`, dont la matrice enregistre
// désormais le composant `betterAuth` et construit une vraie identité de
// session pour chaque rôle (voir
// `packages/backend/testing/betterAuthFixture.ts`) —
// `requireRole` a réellement besoin des deux, donc `invoke` n'a besoin de
// rien de spécial ici au-delà d'appeler la mutation normalement.
MUTATION_REGISTRY.push({
  name: "profiles.updateMine",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: (t) => t.mutation(api.profiles.updateMine, { displayName: "registry-check" }),
})

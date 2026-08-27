import { ConvexError, v } from "convex/values"
import { internalMutation, mutation, query } from "./_generated/server"
import { api } from "./_generated/api"
import { requireRole } from "./lib/authz"
import { MUTATION_REGISTRY } from "./_registry"

// Chemin de secours pour un profil manquant (composant rejoué, réparation
// manuelle) et cible directe des tests d'idempotence — le chemin nominal
// pour créer un profil est le trigger `onCreate` de `auth.ts`, pas cette
// mutation appelée à la main. Idempotente par construction : `.unique()`
// sur `by_auth_user` lèverait si un doublon existait déjà, donc "déjà
// présent -> ne rien refaire" est aussi ce qui empêche ce doublon d'exister
// en premier lieu, y compris si le hook Better Auth rejoue l'opération.
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
export const me = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", authUser._id))
      .unique()
    return { ...profile, role: authUser.role, email: authUser.email }
  },
})

// Modifie uniquement le profil de l'appelant : aucun paramètre ne désigne
// un profil ou un utilisateur cible, donc il n'existe structurellement
// aucune façon de passer l'id de quelqu'un d'autre ici. Le profil à
// modifier est systématiquement recherché via l'`authUserId` de
// l'appelant, jamais reçu en argument. La vérification explicite ci
// -dessous (`profile.authUserId === authUser._id`) est redondante avec la
// recherche indexée qui la précède — elle documente et fait respecter cet
// invariant plutôt que de faire confiance implicitement à la requête, dans
// le même esprit défensif que le reste de `convex/lib/`. Un admin qui veut
// éditer le profil de quelqu'un d'autre passe par l'écran de gestion des
// utilisateurs (Task 10), pas par ici.
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
    if (!profile || profile.authUserId !== authUser._id) {
      throw new ConvexError({ code: "NOT_FOUND" })
    }

    const patch: { displayName?: string; avatarId?: typeof args.avatarId } = {}
    if (args.displayName !== undefined) patch.displayName = args.displayName
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
// `invoke` appelle la mutation réelle telle quelle : ce registre est
// partagé avec `convex/lib/authz.test.ts`, dont la matrice construit `t`
// avec une identité Convex nue (`t.withIdentity({ subject: "u_<role>" })`),
// sans enregistrer le composant `betterAuth` ni créer de session — hors
// de portée de `requireRole`, qui a besoin des deux. Ce harnais-là ne
// peut donc pas exercer une mutation qui passe par `authComponent`
// (aucune mutation de cette tâche ne le peut) ; la couverture réelle
// (owner/admin/editor via une vraie session Better Auth, et la preuve que
// `updateMine` ne touche jamais qu'au profil de l'appelant) vit dans
// `profiles.test.ts`, à côté du reste des tests qui dépendent du même
// fixture `betterAuth` enregistré.
MUTATION_REGISTRY.push({
  name: "profiles.updateMine",
  allowedRoles: ["owner", "admin", "editor"],
  invoke: (t) => t.mutation(api.profiles.updateMine, { displayName: "registry-check" }),
})

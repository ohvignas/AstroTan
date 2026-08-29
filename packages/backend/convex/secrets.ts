import { ConvexError, v } from "convex/values"
import type { Infer } from "convex/values"
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import type { ActionCtx } from "./_generated/server"
import { api, internal } from "./_generated/api"
import { requireRole } from "./lib/authz"
import { MUTATION_REGISTRY } from "./_registry"
import {
  SECRETS_KEY_COMMANDE,
  chiffrer,
  dechiffrer,
  lireCleMaitresse,
  quatreDerniers,
} from "./lib/secretsCrypto"

// ---------------------------------------------------------------------
// Les jetons qu'on peut saisir depuis l'écran des réglages.
//
// LA CONTRAINTE QUI DÉCIDE DE TOUT : une mutation Convex ne peut pas écrire
// une variable d'environnement Convex. Celles-ci ne se posent qu'au
// déploiement, par la CLI ou le tableau de bord. Un jeton saisi dans
// l'interface finit donc forcément en base — un cran en dessous de
// l'environnement en sécurité, demandé en connaissance de cause, et le rôle
// de ce module est de rendre ce cran aussi étroit que possible :
//
//   • table dédiée, jamais `settings` — celle-là a une projection publique ;
//   • valeur CHIFFRÉE (AES-GCM) sous une clé maîtresse qui, elle, reste
//     dans l'environnement : une copie de la base ne suffit plus ;
//   • aucune query ne rend jamais `iv`, `chiffre`, ni la valeur en clair.
//     Ce qui remonte : configuré oui/non, les quatre derniers caractères,
//     la date. `secrets.test.ts` échoue si autre chose sort.
//
// LA PRÉCÉDENCE, tranchée ici et nulle part ailleurs :
//
//   **L'ENVIRONNEMENT GAGNE.** Si `process.env.X` existe, c'est lui qui
//   sert, et la valeur en base est ignorée.
//
// Deux raisons. L'environnement est plus sûr — il ne traverse ni la base,
// ni une sauvegarde, ni le tableau de bord Convex. Et un opérateur qui a
// posé une variable par la CLI ne doit pas se la faire écraser par un
// formulaire, depuis une autre session, sans rien voir.
//
// Le prix de cette règle est qu'une clé saisie à l'écran peut n'avoir aucun
// effet, en silence. C'est exactement le genre de silence que ce dépôt
// refuse : l'écran l'écrit, la query `status` rend `source` pour qu'il
// puisse le dire, et non un simple booléen « configuré ».
// ---------------------------------------------------------------------

/**
 * La liste close. Rien d'autre n'entre dans la table — ni un nom inventé
 * par un client, ni une variable `PUBLIC_*` d'`apps/web`, qui est figée au
 * build de l'image du site et qu'aucune valeur en base ne pourrait changer.
 */
export const SECRET_NOMS = [
  "OPENROUTER_API_KEY",
  "RESEND_API_KEY",
  "UMAMI_API_URL",
  "UMAMI_API_WEBSITE_ID",
  "UMAMI_API_USERNAME",
  "UMAMI_API_PASSWORD",
  "UMAMI_API_SHARE_ID",
] as const

export type SecretNom = (typeof SECRET_NOMS)[number]

// Écrit à la main plutôt que déduit de `SECRET_NOMS` par un `map` : un
// `v.union(...tableau.map(v.literal))` perd le type littéral en route et
// rend l'argument `string` côté client, ce qui est exactement le contrôle
// qu'on veut ici. La divergence entre les deux listes est rattrapée par la
// vérification de type juste en dessous, au typecheck, sans rien à
// l'exécution.
const nomValidator = v.union(
  v.literal("OPENROUTER_API_KEY"),
  v.literal("RESEND_API_KEY"),
  v.literal("UMAMI_API_URL"),
  v.literal("UMAMI_API_WEBSITE_ID"),
  v.literal("UMAMI_API_USERNAME"),
  v.literal("UMAMI_API_PASSWORD"),
  v.literal("UMAMI_API_SHARE_ID")
)

// Les deux listes disent la même chose, et `tsc` échoue si l'une prend un
// nom que l'autre n'a pas — dans les deux sens.
type NomValide = Infer<typeof nomValidator>
const _memeListe: [SecretNom extends NomValide ? true : false, NomValide extends SecretNom ? true : false] = [true, true]
void _memeListe

/**
 * Large, mais pas illimité : une clé d'API tient en une ligne, et un champ
 * sans borne est une façon d'écrire n'importe quoi dans la base.
 */
export const MAX_SECRET_LENGTH = 2048

/** D'où vient la valeur qui SERT réellement, une fois la précédence appliquée. */
export type SecretSource = "environnement" | "base" | "aucune"

/**
 * L'état de chaque jeton — jamais sa valeur.
 *
 * `owner`/`admin` seulement, à la différence de `settings.environment` qui
 * laisse aussi passer un editor : celle-ci rend les quatre derniers
 * caractères, qui sont un fragment de secret, et l'écriture est de toute
 * façon réservée aux deux mêmes rôles. Un editor garde l'écran, avec les
 * booléens que `settings.environment` lui donne déjà.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin"])
    const cle = lireCleMaitresse(process.env)
    const rangees = await ctx.db.query("secrets").collect()
    const parNom = new Map(rangees.map((row) => [row.nom, row]))

    const secrets = []
    for (const nom of SECRET_NOMS) {
      const row = parNom.get(nom)
      const environnement = Boolean(process.env[nom])
      // Déchiffré ici pour une seule question — « cette ligne est-elle
      // encore lisible ? » — et la réponse seule sort. Une query PEUT
      // déchiffrer : le déterminisme n'interdit que l'aléa, et déchiffrer
      // n'en consomme pas. Seul le CHIFFREMENT doit se faire en action.
      let illisible = false
      if (row !== undefined) {
        if (!cle.ok) {
          illisible = true
        } else {
          try {
            await dechiffrer(cle.octets, row.iv, row.chiffre)
          } catch {
            // La clé maîtresse a changé depuis l'écriture. Le dire plutôt
            // que d'afficher une pastille verte sur une valeur perdue.
            illisible = true
          }
        }
      }
      const utilisable = row !== undefined && !illisible
      secrets.push({
        nom,
        environnement,
        base: row !== undefined,
        illisible,
        quatreDerniers: row?.quatreDerniers ?? null,
        majAt: row?.majAt ?? null,
        source: (environnement
          ? "environnement"
          : utilisable
            ? "base"
            : "aucune") satisfies SecretSource as SecretSource,
      })
    }

    // Annoté plutôt que déduit : sans cette annotation, TypeScript élargit
    // le ternaire en `string`, et l'écran perd la garantie d'exhaustivité
    // sur les trois cas.
    const cleMaitresse: "posee" | "absente" | "illisible" = cle.ok
      ? "posee"
      : cle.raison === "MISSING"
        ? "absente"
        : "illisible"

    /** Sans clé maîtresse, `set` refuse — l'écran affiche la commande. */
    return { cleMaitresse, secrets }
  },
})

/**
 * La ligne brute, pour `lireSecret` seulement.
 *
 * `internalQuery` : inatteignable depuis un client. C'est la seule fonction
 * du dépôt qui rend `iv` et `chiffre`, et le fait qu'elle soit interne est
 * ce qui permet à toutes les autres de n'avoir jamais à y penser.
 */
export const brut = internalQuery({
  args: { nom: nomValidator },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("secrets")
      .withIndex("by_nom", (q) => q.eq("nom", args.nom))
      .unique()
    if (row === null) return null
    return { iv: row.iv, chiffre: row.chiffre }
  },
})

/**
 * Range la ligne déjà chiffrée. Appelée par l'action `set`, jamais seule :
 * elle ne sait pas chiffrer et ne doit pas apprendre — l'IV aléatoire est
 * précisément ce qu'une mutation ne peut pas produire.
 */
export const ranger = internalMutation({
  args: {
    nom: nomValidator,
    iv: v.bytes(),
    chiffre: v.bytes(),
    quatreDerniers: v.string(),
    majPar: v.string(),
  },
  handler: async (ctx, args) => {
    const existante = await ctx.db
      .query("secrets")
      .withIndex("by_nom", (q) => q.eq("nom", args.nom))
      .unique()
    const patch = {
      iv: args.iv,
      chiffre: args.chiffre,
      quatreDerniers: args.quatreDerniers,
      majAt: Date.now(),
      majPar: args.majPar,
    }
    if (existante !== null) {
      await ctx.db.patch(existante._id, patch)
      return existante._id
    }
    return ctx.db.insert("secrets", { nom: args.nom, ...patch })
  },
})

/**
 * Saisir ou remplacer un jeton.
 *
 * Une `action`, et c'est structurel : AES-GCM exige un IV aléatoire et
 * unique à chaque chiffrement, or l'aléa d'une query ou d'une mutation
 * Convex est ensemencé pour rester déterministe. Chiffrer là aurait pu
 * rejouer un IV sous la même clé, ce qui est la seule faute qu'AES-GCM ne
 * pardonne pas. Le flux est donc : action qui chiffre → `internalMutation`
 * qui range.
 *
 * Refuse sans clé maîtresse, plutôt que de se rabattre sur un stockage en
 * clair : un chiffrement à clé absente ou connue d'avance est décoratif, et
 * un écran qui affiche « chiffré » sur du clair est pire que pas de
 * chiffrement du tout.
 */
export const set = action({
  args: { nom: nomValidator, valeur: v.string() },
  handler: async (ctx, args): Promise<null> => {
    // Pas `editor` : classer des leads et détenir la clé de facturation
    // d'un fournisseur d'IA ne sont pas le même pouvoir.
    const acteur = await requireRole(ctx, ["owner", "admin"])

    const valeur = args.valeur.trim()
    // Vide veut dire « ne change rien » dans le formulaire, qui n'envoie
    // alors rien du tout. Arrivé jusqu'ici, c'est un appel direct, et
    // écrire une chaîne vide chiffrée fabriquerait un jeton « configuré »
    // qui ne vaut rien. Pour retirer, il y a `clear`.
    if (valeur.length === 0) throw new ConvexError({ code: "EMPTY_SECRET" })
    if (valeur.length > MAX_SECRET_LENGTH) {
      throw new ConvexError({
        code: "FIELD_TOO_LONG",
        field: args.nom,
        max: MAX_SECRET_LENGTH,
      })
    }

    const cle = lireCleMaitresse(process.env)
    if (!cle.ok) {
      throw new ConvexError({
        code: cle.raison === "MISSING" ? "SECRETS_KEY_MISSING" : "SECRETS_KEY_MALFORMED",
        commande: SECRETS_KEY_COMMANDE,
      })
    }

    const { iv, chiffre } = await chiffrer(cle.octets, valeur)
    await ctx.runMutation(internal.secrets.ranger, {
      nom: args.nom,
      iv,
      chiffre,
      quatreDerniers: quatreDerniers(valeur),
      majPar: acteur._id,
    })
    return null
  },
})

/**
 * Retirer un jeton de la base.
 *
 * Ne touche jamais à la variable d'environnement du même nom — l'écran le
 * dit, sinon « j'ai supprimé et c'est toujours configuré » ressemble à un
 * bug alors que c'est la précédence qui parle.
 */
export const clear = mutation({
  args: { nom: nomValidator },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])
    const row = await ctx.db
      .query("secrets")
      .withIndex("by_nom", (q) => q.eq("nom", args.nom))
      .unique()
    // Absente : réponse ordinaire, pas une erreur. Deux onglets ouverts, et
    // le second clic n'a plus rien à supprimer.
    if (row !== null) await ctx.db.delete(row._id)
    return null
  },
})

/**
 * LE point de lecture. Un seul, et c'est la raison d'être de cette fonction.
 *
 * Toute fonction qui a besoin d'un de ces jetons passe par ici, pour que la
 * règle de précédence — l'environnement d'abord, la base ensuite — soit
 * décidée à un seul endroit plutôt que recopiée dans chaque appelant, où
 * deux copies finiraient par diverger.
 *
 * Rend `null` pour « non configuré », y compris quand la ligne existe mais
 * ne se déchiffre plus (clé maîtresse changée). Un appelant analytique ne
 * doit pas tomber en panne pour cela : `secrets.status` porte la mention
 * `illisible`, et c'est l'écran qui l'explique.
 *
 * `ActionCtx` : la lecture passe par `internal.secrets.brut`, donc depuis
 * une action. C'est aussi là que vivent les appels sortants — Umami, Resend,
 * OpenRouter — qui sont les seuls consommateurs légitimes.
 */
export async function lireSecret(
  ctx: ActionCtx,
  nom: SecretNom
): Promise<string | null> {
  const depuisEnv = process.env[nom]
  if (depuisEnv) return depuisEnv

  const cle = lireCleMaitresse(process.env)
  if (!cle.ok) return null

  const range = await ctx.runQuery(internal.secrets.brut, { nom })
  if (range === null) return null
  try {
    return await dechiffrer(cle.octets, range.iv, range.chiffre)
  } catch {
    return null
  }
}

// `clear` est une mutation publique : le registre l'exige, et
// `lib/authz.test.ts` la déroule rôle par rôle.
//
// `set` N'Y EST PAS, et c'est une lacune connue plutôt qu'un oubli : c'est
// une `action`, et `_registry.test.ts` ne balaye que `isMutation &&
// isPublic` PUIS exige l'égalité stricte entre ce qu'il trouve et ce que le
// registre déclare — une entrée d'action de plus le fait échouer. Trois
// actions publiques d'`analytics.ts` sont dans le même cas. Élargir le
// filtre aux actions est le vrai correctif ; il touche `analytics.ts`, hors
// du périmètre de cette tâche.
//
// En attendant, `secrets.test.ts` couvre exactement ce que la matrice
// couvrirait : owner et admin passent, un editor et un appelant sans
// session sont refusés.
MUTATION_REGISTRY.push({
  name: "secrets.clear",
  allowedRoles: ["owner", "admin"],
  invoke: (t) => t.mutation(api.secrets.clear, { nom: "OPENROUTER_API_KEY" }),
})

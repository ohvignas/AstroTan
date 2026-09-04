import { ConvexError, v } from "convex/values"
import { action, query } from "./_generated/server"
import { api, internal } from "./_generated/api"
import { requireRole } from "./lib/authz"
import { MUTATION_REGISTRY } from "./_registry"
import { pingDataForSeo, type DataForSeoIssue } from "./lib/dataforseo"
import {
  SECRETS_KEY_COMMANDE,
  chiffrer,
  dechiffrer,
  lireCleMaitresse,
} from "./lib/secretsCrypto"
import { MAX_SECRET_LENGTH, lireSecret } from "./secrets"

export type { DataForSeoIssue }

/**
 * Ce que l'écran relit pour rouvrir le formulaire.
 *
 * **Le login sort en clair, et c'est délibéré** : c'est l'adresse du compte
 * API, pas un secret — DataForSEO l'affiche dans son propre tableau de
 * bord. Le traiter comme un jeton avait un coût précis, et c'est la panne
 * qui a mené à cette fonction : l'écran ne pouvait réafficher qu'un masque
 * de douze points, le bouton exigeait de les effacer pour se réactiver, et
 * essayer la connexion demandait donc de retaper à l'aveugle un
 * identifiant que le serveur détenait déjà.
 *
 * **Le mot de passe ne sort jamais**, ni entier ni en fragment : seul
 * `passwordPose` dit qu'il y en a un, ce qui suffit à l'écran pour savoir
 * que le bouton peut essayer sans le redemander.
 *
 * `owner`/`admin`, la même population que `secrets.status`.
 */
export const identifiants = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ login: string | null; passwordPose: boolean }> => {
    await requireRole(ctx, ["owner", "admin"])
    const cle = lireCleMaitresse(process.env)
    const ligne = (nom: "DATAFORSEO_LOGIN" | "DATAFORSEO_PASSWORD") =>
      ctx.db
        .query("secrets")
        .withIndex("by_nom", (q) => q.eq("nom", nom))
        .unique()

    // Sans clé maîtresse, une ligne en base ne se déchiffre pas : la
    // compter comme posée ferait promettre à l'écran un essai qui
    // échouerait au premier appel.
    const passwordPose =
      Boolean(process.env.DATAFORSEO_PASSWORD) ||
      (cle.ok && (await ligne("DATAFORSEO_PASSWORD")) !== null)

    // Même précédence que `lireSecret` — l'environnement gagne. Recopiée
    // ici, et le commentaire est la moitié du correctif : une query ne
    // peut pas appeler `internal.secrets.brut`, `runQuery` n'existant que
    // dans une action. Toute évolution de la règle touche les deux.
    const depuisEnv = process.env.DATAFORSEO_LOGIN
    if (depuisEnv) return { login: depuisEnv, passwordPose }
    if (!cle.ok) return { login: null, passwordPose }
    const row = await ligne("DATAFORSEO_LOGIN")
    if (row === null) return { login: null, passwordPose }
    try {
      const login = await dechiffrer(cle.octets, row.iv, row.chiffre)
      return { login, passwordPose }
    } catch {
      // La clé maîtresse a changé depuis l'écriture. `secrets.status`
      // porte la mention « illisible » ; ici, il n'y a rien à réafficher.
      return { login: null, passwordPose }
    }
  },
})

/**
 * Essayer les identifiants, puis ranger ce qui a été saisi s'ils passent.
 *
 * Un seul geste, et un seul bouton à l'écran : login et mot de passe ne
 * valent rien l'un sans l'autre, et `secretCheck.essayer` ne prend qu'une
 * valeur. Rien n'est écrit si DataForSEO refuse ou ne répond pas. Le mot de
 * passe ne sort jamais — ni dans le verdict, ni dans le journal (`ranger`
 * n'y met que le nom).
 *
 * **Mot de passe vide = celui déjà rangé.** C'est ce qui fait du bouton un
 * vrai bouton d'essai : sans cela, vérifier une connexion exigerait de
 * ressaisir un secret que le serveur détient, et que l'écran ne peut pas
 * préremplir sans le faire sortir.
 */
export const enregistrer = action({
  args: { login: v.string(), password: v.string() },
  handler: async (ctx, args): Promise<{ verdict: DataForSeoIssue }> => {
    const acteur = await requireRole(ctx, ["owner", "admin"])
    const login = args.login.trim()
    const saisi = args.password.trim()
    if (
      login.length === 0 ||
      login.length > MAX_SECRET_LENGTH ||
      saisi.length > MAX_SECRET_LENGTH
    ) {
      return { verdict: "refuse" }
    }

    const password =
      saisi.length > 0 ? saisi : await lireSecret(ctx, "DATAFORSEO_PASSWORD")
    if (password === null || password.length === 0) return { verdict: "refuse" }

    let verdict: DataForSeoIssue
    try {
      verdict = await pingDataForSeo(login, password)
    } catch {
      return { verdict: "injoignable" }
    }
    if (verdict !== "valide") return { verdict }

    const cle = lireCleMaitresse(process.env)
    if (!cle.ok) {
      throw new ConvexError({
        code: cle.raison === "MISSING" ? "SECRETS_KEY_MISSING" : "SECRETS_KEY_MALFORMED",
        commande: SECRETS_KEY_COMMANDE,
      })
    }

    // Le mot de passe n'est réécrit que s'il a été saisi : le rechiffrer à
    // l'identique ferait une ligne de journal « remplacement » sur un
    // geste qui n'a rien remplacé.
    const aRanger: { nom: "DATAFORSEO_LOGIN" | "DATAFORSEO_PASSWORD"; valeur: string }[] =
      [{ nom: "DATAFORSEO_LOGIN", valeur: login }]
    if (saisi.length > 0) {
      aRanger.push({ nom: "DATAFORSEO_PASSWORD", valeur: saisi })
    }

    for (const { nom, valeur } of aRanger) {
      const { iv, chiffre } = await chiffrer(cle.octets, valeur)
      await ctx.runMutation(internal.secrets.ranger, {
        nom,
        iv,
        chiffre,
        majPar: acteur._id,
        majParEmail: acteur.email,
      })
    }
    return { verdict: "valide" }
  },
})

// Login et mot de passe vides : `requireRole` s'exerce, puis le refus
// tombe AVANT le fetch. La matrice de `lib/authz.test.ts` appelle vraiment
// cette action — un couple vérifiable partirait interroger api.dataforseo.com.
MUTATION_REGISTRY.push({
  name: "dataforseo.enregistrer",
  allowedRoles: ["owner", "admin"],
  invoke: (t) => t.action(api.dataforseo.enregistrer, { login: "", password: "" }),
})

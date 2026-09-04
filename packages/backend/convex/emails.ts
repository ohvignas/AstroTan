import { ConvexError, v } from "convex/values"
import {
  action,
  internalAction,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import type { ActionCtx, QueryCtx } from "./_generated/server"
import { api, internal } from "./_generated/api"
import { MUTATION_REGISTRY } from "./_registry"
import { requireRole } from "./lib/authz"
import { journaliser } from "./lib/auditEvent"
import { CATALOGUE, type CleEmail, type DescriptionEmail } from "./lib/catalogueEmails"
import { validerGabarit } from "./lib/gabarit"
import { composerMessage, identiteAvecLogoJoignable, valeursExemple } from "./lib/emailLayout"
import { makeResend } from "./lib/resend"
import { resoudreExpediteur } from "./lib/expediteur"
import { deriverOrigines } from "./lib/origines"
import { lireSecret } from "./secrets"
import { listUsersWithRole } from "./users"
import { isCurrentlyBanned } from "./lib/authz"
import { choisirDestinataireInterne } from "./lib/destinataireInterne"

// ---------------------------------------------------------------------
// L'écran « envoi des emails » : ce que le site écrit, à qui, et ce que
// l'adoptant en a changé.
//
// **Le repli vers le code est la fonctionnalité, pas un cas d'erreur.**
// L'absence de ligne dans `emailTemplates` est l'état de tout déploiement
// neuf, et le restera pour la plupart : `gabaritPour` rend alors le
// littéral de `lib/catalogueEmails.ts`, sans que le moindre appelant ait à
// s'en apercevoir. Même forme que `choisirExpediteur`
// (`lib/expediteur.ts`), qui replie déjà sur une adresse du code quand le
// réglage manque.
//
// DEUX exigences distinctes autour du même mot « valide », et les
// confondre en laisserait une des deux non tenue :
//
//   1. **À l'écriture** : un gabarit refusé n'est jamais écrit.
//      `setTemplate` valide avant d'insérer, et lève — la ligne n'existe
//      pas, donc rien n'a changé de ce qui part.
//   2. **À la lecture** : un gabarit devenu invalide ne bloque jamais un
//      envoi. Le scénario n'est pas hypothétique : une version ultérieure
//      du catalogue ajoute une variable obligatoire, et les gabarits
//      enregistrés avant ne l'ont pas. Ils ont passé la validation du
//      jour où ils ont été écrits, et l'échouent aujourd'hui. Sans
//      revalidation à la lecture, l'invitation d'un déploiement à jour
//      partirait sans son lien — ou pas du tout.
//
// La seconde est ce qui rend la première sûre : on peut refuser fermement
// à l'écriture précisément parce qu'aucune ligne, même mauvaise, ne peut
// arrêter un envoi.
// ---------------------------------------------------------------------

/** Les clés que le catalogue connaît, comme validateur d'argument. */
const cleValidator = v.union(...CATALOGUE.map((email) => v.literal(email.cle)))

/** La description du catalogue, ou une erreur — jamais un `undefined` silencieux. */
function decrire(cle: CleEmail): DescriptionEmail {
  const description = CATALOGUE.find((email) => email.cle === cle)
  // Inatteignable via l'API (`cleValidator` ferme l'union côté Convex) ;
  // atteignable depuis un appelant interne qui se tromperait de clé.
  if (!description) throw new ConvexError({ code: "NOT_FOUND", cle })
  return description
}

/** La ligne en base pour cette clé, ou `null` — le cas normal. */
async function ligneFor(ctx: QueryCtx, cle: CleEmail) {
  return ctx.db
    .query("emailTemplates")
    .withIndex("by_cle", (q) => q.eq("cle", cle))
    .unique()
}

/** Ce qui part réellement pour un email donné, ligne ou pas ligne. */
export type GabaritResolu = {
  objet: string
  corps: string
  /** Faux quand l'adoptant a coupé cet envoi. Toujours vrai si non désactivable. */
  actif: boolean
  /** Vrai quand c'est le texte de l'adoptant qui part, faux quand c'est celui du code. */
  personnalise: boolean
  /**
   * Pourquoi le texte enregistré a été écarté, ou `null`.
   *
   * Rendu plutôt que levé : un envoi ne doit pas échouer parce qu'un
   * gabarit a vieilli, et l'écran a besoin de la phrase pour le dire.
   */
  probleme: string | null
}

/**
 * LE point de lecture d'un gabarit. Un seul, et c'est sa raison d'être.
 *
 * Tout envoi passe par ici, pour que la règle de repli — la ligne si elle
 * existe ET vaut encore, le littéral du code sinon — soit décidée à un
 * seul endroit plutôt que recopiée dans `invitations.ts` et `leads.ts`, où
 * deux copies finiraient par diverger sans que rien ne le dise.
 *
 * `actif` est forcé à vrai sur un email non désactivable, quoi que porte
 * la ligne. `setActif` refuse déjà de l'écrire ; ce forçage est la
 * seconde barrière, celle qui tient même si une ligne arrive par un autre
 * chemin (une restauration de sauvegarde, un `npx convex import`, une
 * version du catalogue où l'email était encore désactivable).
 */
export async function gabaritPour(ctx: QueryCtx, cle: CleEmail): Promise<GabaritResolu> {
  const description = decrire(cle)
  const ligne = await ligneFor(ctx, cle)
  const actif = description.desactivable ? (ligne?.actif ?? true) : true

  const defaut: GabaritResolu = {
    objet: description.objetParDefaut,
    corps: description.corpsParDefaut,
    actif,
    personnalise: false,
    probleme: null,
  }

  if (!ligne || ligne.objet === undefined || ligne.corps === undefined) return defaut

  const probleme = validerGabarit(description, ligne.objet, ligne.corps)
  if (probleme) return { ...defaut, probleme }

  return { objet: ligne.objet, corps: ligne.corps, actif, personnalise: true, probleme: null }
}

/**
 * La même lecture, atteignable depuis une action.
 *
 * `invitations.ts` et `leads.ts` envoient depuis des actions, qui n'ont
 * pas de `ctx.db` : sans cette query interne, chacune redescendrait vers
 * la table par ses propres moyens — exactement la duplication que
 * `gabaritPour` existe pour éviter.
 */
export const gabarit = internalQuery({
  args: { cle: cleValidator },
  handler: (ctx, args): Promise<GabaritResolu> => gabaritPour(ctx, args.cle),
})

/** Une ligne de l'écran : le catalogue, plus ce que l'adoptant en a fait. */
export type LigneEmail = {
  cle: CleEmail
  titre: string
  quand: string
  destinataire: string
  desactivable: boolean
  raisonNonDesactivable: string | null
  variables: string[]
  variablesObligatoires: string[]
  objetParDefaut: string
  corpsParDefaut: string
  /** Ce qui part aujourd'hui — le texte de l'adoptant, ou celui du code. */
  objet: string
  corps: string
  actif: boolean
  personnalise: boolean
  probleme: string | null
  /**
   * Le texte enregistré, MÊME invalide.
   *
   * Sans lui, un gabarit écarté par la revalidation serait invisible : la
   * personne lirait « votre texte n'est plus valide » en face du texte par
   * défaut, sans jamais voir celui qu'on lui demande de réparer.
   */
  enregistre: { objet: string; corps: string } | null
  majAt: number | null
  /** Le nom d'affichage de qui a modifié, comme le journal l'écrit. */
  majParNom: string | null
}

/**
 * Le catalogue entier, enrichi de l'état en base.
 *
 * Rend TOUJOURS une ligne par email du catalogue, jamais une par ligne de
 * table : l'écran montre ce que le site peut envoyer, pas ce que
 * quelqu'un a déjà modifié. C'est ce qui lui permet de dire
 * « personnalisé » ou « par défaut » sans deviner.
 *
 * `owner`/`admin` seulement : le texte d'une invitation décide de ce que
 * lit une personne à qui on ouvre l'administration, et couper une
 * notification décide de ce que l'équipe ne verra plus. Un editor classe
 * des leads.
 */
export const list = query({
  args: {},
  handler: async (ctx): Promise<LigneEmail[]> => {
    await requireRole(ctx, ["owner", "admin"])

    const lignes: LigneEmail[] = []
    for (const description of CATALOGUE) {
      const ligne = await ligneFor(ctx, description.cle)
      const resolu = await gabaritPour(ctx, description.cle)
      const enregistre =
        ligne && ligne.objet !== undefined && ligne.corps !== undefined
          ? { objet: ligne.objet, corps: ligne.corps }
          : null

      lignes.push({
        cle: description.cle,
        titre: description.titre,
        quand: description.quand,
        destinataire: description.destinataire,
        desactivable: description.desactivable,
        raisonNonDesactivable: description.raisonNonDesactivable ?? null,
        variables: [...description.variables],
        variablesObligatoires: [...description.variablesObligatoires],
        objetParDefaut: description.objetParDefaut,
        corpsParDefaut: description.corpsParDefaut,
        objet: resolu.objet,
        corps: resolu.corps,
        actif: resolu.actif,
        personnalise: resolu.personnalise,
        probleme: resolu.probleme,
        enregistre,
        majAt: ligne?.majAt ?? null,
        majParNom: ligne ? await nomDeLAuteur(ctx, ligne.majPar) : null,
      })
    }
    return lignes
  },
})

/**
 * Le nom d'affichage de qui a modifié la ligne, ou `null`.
 *
 * `null` plutôt que l'identifiant Better Auth en repli : celui-ci ne dit
 * rien à personne, et l'écran affiche déjà la date. Un profil peut manquer
 * le temps qu'`auth.onUpdate` le crée, ou après un compte supprimé.
 */
async function nomDeLAuteur(ctx: QueryCtx, authUserId: string): Promise<string | null> {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", authUserId))
    .unique()
  return profile?.displayName ?? null
}

/**
 * Enregistrer un texte réécrit — ou refuser, sans rien écrire.
 *
 * La validation vient AVANT toute écriture, et c'est l'ordre qui compte :
 * une ligne écrite puis rattrapée aurait déjà changé ce que le site
 * envoie, le temps que le rattrapage arrive.
 *
 * `objet`/`corps` sont posés ensemble, jamais l'un sans l'autre :
 * `validerGabarit` juge la paire (une variable obligatoire peut vivre dans
 * l'un ou dans l'autre), et un objet enregistré seul laisserait un corps
 * validé contre un objet qui n'existe plus.
 */
export const setTemplate = mutation({
  args: { cle: cleValidator, objet: v.string(), corps: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const acteur = await requireRole(ctx, ["owner", "admin"])
    const description = decrire(args.cle)

    const probleme = validerGabarit(description, args.objet, args.corps)
    if (probleme) throw new ConvexError({ code: "GABARIT_INVALIDE", message: probleme })

    const ligne = await ligneFor(ctx, args.cle)
    if (ligne) {
      await ctx.db.patch(ligne._id, {
        objet: args.objet,
        corps: args.corps,
        majPar: acteur._id,
        majAt: Date.now(),
      })
    } else {
      await ctx.db.insert("emailTemplates", {
        cle: args.cle,
        objet: args.objet,
        corps: args.corps,
        actif: true,
        majPar: acteur._id,
        majAt: Date.now(),
      })
    }

    // `cible` est le TITRE de l'email, jamais son objet ni son corps. Un
    // gabarit peut porter la signature de l'entreprise, un lien interne,
    // le nom d'un client ; `auditLog` n'est balayée par aucune purge de
    // `retention.ts` et se relit longtemps après, par plus de monde que
    // cet écran. Le journal dit QUI a changé QUOI — jamais le contenu.
    await journaliser(ctx, {
      acteur,
      action: "emailTemplate.set",
      cible: description.titre,
    })
    return null
  },
})

/**
 * Couper ou rétablir un envoi — et REFUSER quand l'email ne se coupe pas.
 *
 * Le refus est ici, côté serveur, et pas seulement dans un bouton grisé :
 * l'UI masque, elle ne décide pas (invariant 3 de `CLAUDE.md`). Ce que
 * cette mutation empêche est très concret pour l'invitation — le seul
 * chemin de création de compte du dépôt (`disableSignUp: true`), dont le
 * jeton en clair est effacé AVANT même la tentative d'envoi et qu'aucune
 * action « renvoyer » ne rattrape. Voir `lib/catalogueEmails.ts` pour les
 * trois faits, chacun suffisant seul.
 *
 * Refuse dans les DEUX sens, y compris `actif: true`. Sur un email non
 * désactivable, l'interrupteur n'existe pas : `gabaritPour` force déjà
 * `actif` à vrai quoi qu'en dise la base, si bien qu'accepter cet appel
 * écrirait une ligne qui ne veut rien dire — et laisserait croire qu'il y
 * avait quelque chose à rétablir.
 */
export const setActif = mutation({
  args: { cle: cleValidator, actif: v.boolean() },
  handler: async (ctx, args): Promise<null> => {
    const acteur = await requireRole(ctx, ["owner", "admin"])
    const description = decrire(args.cle)

    if (!description.desactivable) {
      throw new ConvexError({
        code: "EMAIL_NON_DESACTIVABLE",
        cle: args.cle,
        raison: description.raisonNonDesactivable,
      })
    }

    const ligne = await ligneFor(ctx, args.cle)
    if (ligne) {
      await ctx.db.patch(ligne._id, { actif: args.actif, majPar: acteur._id, majAt: Date.now() })
    } else {
      // Une ligne SANS texte : l'interrupteur a bougé, le texte non. C'est
      // ce que `objet`/`corps` optionnels achètent — sans eux, il aurait
      // fallu recopier ici le défaut du catalogue, et geler ce texte pour
      // toujours chez quelqu'un qui n'y a jamais touché.
      await ctx.db.insert("emailTemplates", {
        cle: args.cle,
        actif: args.actif,
        majPar: acteur._id,
        majAt: Date.now(),
      })
    }

    await journaliser(ctx, {
      acteur,
      action: "emailTemplate.toggle",
      cible: description.titre,
      detail: args.actif ? "réactivé" : "désactivé",
    })
    return null
  },
})

/**
 * Revenir au texte du code.
 *
 * Efface le texte, PAS l'interrupteur : rétablir un texte par défaut n'est
 * pas la même décision que remettre en route un envoi qu'on avait coupé,
 * et les enchaîner en silence ferait repartir des emails que personne n'a
 * redemandés. La ligne disparaît quand il ne lui reste plus rien à dire
 * (texte effacé et envoi actif), pour que « aucune ligne » garde son sens
 * exact : rien n'a jamais été touché.
 */
export const resetTemplate = mutation({
  args: { cle: cleValidator },
  handler: async (ctx, args): Promise<null> => {
    const acteur = await requireRole(ctx, ["owner", "admin"])
    const description = decrire(args.cle)

    const ligne = await ligneFor(ctx, args.cle)
    // Absente : réponse ordinaire, pas une erreur — deux onglets ouverts,
    // et le second clic n'a plus rien à rétablir. Rien n'est journalisé
    // alors : une ligne « a rétabli » sur un geste qui n'a rien rétabli
    // rendrait le journal faux, ce qui est pire qu'incomplet. Même
    // raisonnement que `secrets.clear`.
    if (!ligne || (ligne.objet === undefined && ligne.corps === undefined)) return null

    if (ligne.actif) {
      await ctx.db.delete(ligne._id)
    } else {
      await ctx.db.patch(ligne._id, {
        objet: undefined,
        corps: undefined,
        majPar: acteur._id,
        majAt: Date.now(),
      })
    }

    await journaliser(ctx, {
      acteur,
      action: "emailTemplate.reset",
      cible: description.titre,
    })
    return null
  },
})

export type ResultatExemple =
  | { ok: true; to: string; testMode: boolean }
  | { ok: false; raison: "sans_cle" | "inactif" | "sans_owner" }

const ADRESSE_TEST_RESEND = "delivered@resend.dev"

function destinataireExemple(to: string, testMode: boolean): string {
  if (!testMode) return to
  return to.toLowerCase().endsWith("@resend.dev") ? to : ADRESSE_TEST_RESEND
}

async function expedierExemple(
  ctx: ActionCtx,
  cle: CleEmail,
  to: string,
): Promise<ResultatExemple> {
  const gabarit = await ctx.runQuery(internal.emails.gabarit, { cle })
  if (!gabarit.actif) return { ok: false, raison: "inactif" }

  const cleResend = await lireSecret(ctx, "RESEND_API_KEY")
  if (!cleResend) return { ok: false, raison: "sans_cle" }

  const identite = await identiteAvecLogoJoignable(
    await ctx.runQuery(internal.settings.identiteEmail, {}),
  )
  const { admin: siteUrl } = deriverOrigines(
    await ctx.runQuery(internal.settings.domaineDeclare, {}),
  )
  const valeurs = valeursExemple(cle, {
    siteName: identite.siteName,
    adminUrl: siteUrl ?? "https://admin.exemple.fr",
  })
  const message = composerMessage(gabarit, valeurs, cle, identite)
  const testMode = process.env.RESEND_TEST_MODE !== "false"
  const dest = destinataireExemple(to, testMode)
  const resend = await makeResend(ctx)
  await resend.sendEmail(ctx, {
    from: await resoudreExpediteur(ctx),
    to: dest,
    ...message,
  })
  return { ok: true, to: dest, testMode }
}

/**
 * Destinataire des exemples sans session (`envoyerExempleInterne`).
 *
 * Plus le premier owner aveugle : un owner `@domaine.test` n'est pas une
 * boîte. On préfère un compte staff dont l'hôte est le domaine déclaré,
 * sinon `emailFrom` s'il y est déjà, et seulement ensuite l'owner.
 */
export const adresseOwner = internalQuery({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const [owners, admins, editors] = await Promise.all([
      listUsersWithRole(ctx, "owner"),
      listUsersWithRole(ctx, "admin"),
      listUsersWithRole(ctx, "editor"),
    ])
    const actifs = [...owners, ...admins, ...editors].filter((user) => !isCurrentlyBanned(user))
    const settings = await ctx.db.query("settings").first()
    return choisirDestinataireInterne({
      owners: owners.filter((user) => !isCurrentlyBanned(user)).map((user) => user.email),
      staff: actifs.map((user) => user.email),
      declaredDomain: settings?.declaredDomain ?? null,
      emailFrom: settings?.emailFrom ?? null,
    })
  },
})

/**
 * Envoie UN exemplaire de cet email à l'adresse de qui clique.
 *
 * Le texte est celui qui part vraiment (`gabaritPour`), pas le brouillon
 * ouvert dans l'éditeur. Les valeurs sont fictives — le jeton d'un
 * exemple n'ouvre aucune porte. Owner/admin seulement : c'est le même
 * pouvoir que réécrire le gabarit.
 */
export const envoyerExemple = action({
  args: { cle: cleValidator },
  handler: async (ctx, args): Promise<ResultatExemple> => {
    const acteur = await requireRole(ctx, ["owner", "admin"])
    return expedierExemple(ctx, args.cle, acteur.email)
  },
})

/**
 * Même envoi, pour `npx convex run` — pas de session, donc l'adresse
 * vient de `adresseOwner` (staff du domaine déclaré, pas un owner `.test`).
 * Inatteignable depuis un client.
 */
export const envoyerExempleInterne = internalAction({
  args: { cle: cleValidator },
  handler: async (ctx, args): Promise<ResultatExemple> => {
    const to = await ctx.runQuery(internal.emails.adresseOwner, {})
    if (!to) return { ok: false, raison: "sans_owner" }
    return expedierExemple(ctx, args.cle, to)
  },
})

// Les trois mutations publiques de ce module, déclarées comme chaque
// module le fait lui-même à l'import. `_registry.test.ts` exige l'égalité
// stricte dans les deux sens : une entrée manquante ET une entrée
// orpheline y échouent.
//
// `setActif` est déclarée sur `leadNotification` et non sur `invitation` :
// la matrice de `lib/authz.test.ts` attend un SUCCÈS pour owner et admin,
// et l'invitation refuse tout le monde — le refus qui fait l'objet d'un
// test à part dans `emails.test.ts`, où il se lit pour ce qu'il est.
MUTATION_REGISTRY.push(
  {
    name: "emails.setTemplate",
    allowedRoles: ["owner", "admin"],
    invoke: (t) =>
      t.mutation(api.emails.setTemplate, {
        cle: "leadNotification",
        objet: "Registry",
        corps: "Registry",
      }),
  },
  {
    name: "emails.setActif",
    allowedRoles: ["owner", "admin"],
    invoke: (t) => t.mutation(api.emails.setActif, { cle: "leadNotification", actif: false }),
  },
  {
    name: "emails.resetTemplate",
    allowedRoles: ["owner", "admin"],
    invoke: (t) => t.mutation(api.emails.resetTemplate, { cle: "leadNotification" }),
  },
  {
    name: "emails.envoyerExemple",
    allowedRoles: ["owner", "admin"],
    invoke: (t) => t.action(api.emails.envoyerExemple, { cle: "leadNotification" }),
  },
)


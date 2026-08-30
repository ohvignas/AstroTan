import { ConvexError, v } from "convex/values"
import { internalQuery, mutation, query } from "./_generated/server"
import { api } from "./_generated/api"
import {
  MAX_SITE_NAME_LENGTH,
  MAX_SOCIALS,
  MAX_SOCIAL_LABEL_LENGTH,
  MAX_SOCIAL_URL_LENGTH,
  seoValidator,
} from "./content"
import { requireRole } from "./lib/authz"
import { journaliser } from "./lib/auditEvent"
import { readUmamiConfig } from "./lib/umamiToken"
import { refuseWebhookUrl } from "./lib/webhookUrl"
import { estAdresseValide } from "./lib/expediteur"
import { normaliserHote } from "./lib/hoteNu"
import { noterSortie, type HoteSortant } from "./lib/hotesSortants"
import { deriverOrigines } from "./lib/origines"
import { MUTATION_REGISTRY } from "./_registry"

// Site-wide settings: one row, or none.
//
// What lives here is what belongs to the *site* rather than to any one page
// — its name, its logo, which page answers at `/`, the SEO defaults a page
// falls back to. A page decides its own slug and its own SEO override; it
// cannot decide that it is the home page, because that is a statement about
// the site, and two pages could otherwise both claim it.
//
// `get` is deliberately public and unauthenticated: `apps/web` has no
// session and no admin key, and it needs the site's name and logo on every
// page.
//
// Un seul secret vit dans cette table — `leadWebhookSecret` — et il est
// tenu par DEUX projections explicites : `get` (publique) et `getPrivate`
// (dashboard). Aucune des deux ne le rend. Il n'y en aura pas d'autre : les
// jetons saisis depuis l'écran vont dans la table `secrets`, chiffrés
// (`convex/secrets.ts`), précisément parce que cette table-ci est lue sans
// session.

// The bounds live in `content.ts` and are re-exported here so existing
// importers — `settings.test.ts` among them — do not have to know they
// moved. Same reason `media.ts` moved its four: the settings screen caps
// the site name and the social rows at exactly these numbers, and
// importing them from *this* module drags its whole graph
// (`_generated/server`, `_registry`, `lib/authz` → `auth.ts`) into the
// browser bundle — which the Convex client reports as "Convex functions
// should not be imported in the browser. This will throw an error in
// future versions of `convex`", once per function definition it finds.
export {
  MAX_SITE_NAME_LENGTH,
  MAX_SOCIALS,
  MAX_SOCIAL_LABEL_LENGTH,
  MAX_SOCIAL_URL_LENGTH,
}

export const socialValidator = v.object({
  label: v.string(),
  url: v.string(),
})

/**
 * The settings row, or `null` when the site has never been configured.
 *
 * `null` is an ordinary answer, not a failure: a freshly cloned template has
 * no settings, and every consumer falls back rather than breaking.
 */
/**
 * Les réglages que le SITE PUBLIC peut lire — et rien d'autre.
 *
 * Cette query n'a pas de contrôle de rôle, et ne peut pas en avoir : le site
 * n'a ni session ni clé d'administration, c'est l'invariant n°1 du projet.
 * Elle est donc appelable par n'importe qui connaissant l'URL Convex, qui
 * est publique par construction — elle est dans le bundle du site.
 *
 * Elle rendait la LIGNE ENTIÈRE. Le jour où un secret est entré dans cette
 * table — le secret de signature du webhook — il est devenu lisible par
 * tout Internet, et il permettait de forger des appels signés vers le
 * scénario de l'opérateur. Une clé d'API OpenRouter y aurait suivi.
 *
 * D'où cette projection EXPLICITE, champ par champ. Ajouter un champ à la
 * table ne l'expose plus par accident : il faut venir l'écrire ici, et le
 * test `settings.publicProjection.test.ts` échoue si un champ sensible
 * apparaît dans le résultat.
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query("settings").first()
    if (settings === null) return null
    return {
      siteName: settings.siteName,
      logoId: settings.logoId,
      iconId: settings.iconId,
      homePageSlug: settings.homePageSlug,
      defaultSeo: settings.defaultSeo,
      socials: settings.socials,
      // `emailFrom` N'EST PAS ICI (relecture finale, correctif 1) : c'est
      // l'adresse d'expédition du site, elle n'a aucune utilité pour
      // `apps/web` — `grep -rn "emailFrom" apps/` n'y trouve aucun
      // consommateur —, et cette query est publique et non authentifiée.
      // La poser ici la rendrait moissonnable par quiconque connaît l'URL
      // Convex, exactement la fuite que `leadWebhookSecret` a déjà coûtée
      // à cette table une fois. Le dashboard la lit par `getPrivate`
      // ci-dessous, réservée à owner/admin/editor.
    }
  },
})

/**
 * Les réglages du site pour le DASHBOARD — projection explicite, elle aussi.
 *
 * Elle rendait la ligne entière, `leadWebhookSecret` compris, à un editor.
 * C'était la même fuite que celle de `get`, refermée d'un seul côté : avec
 * ce secret et `leadWebhookUrl` — rendu lui aussi — un editor forge des
 * en-têtes `x-astrotan-signature` valides et injecte de faux leads dans le
 * scénario n8n/Make de l'opérateur. Classer des leads ne donne pas ce
 * pouvoir-là.
 *
 * Le correctif retenu est la projection plutôt que la restriction de rôle,
 * pour deux raisons : l'écran garde UNE query de lecture (un editor a le
 * droit de voir le nom du site, les réseaux, le SEO par défaut et l'état du
 * dernier envoi), et le secret devient une demande explicite —
 * `webhookSecret` ci-dessous — au lieu d'un passager clandestin dans une
 * réponse qu'on lit pour autre chose.
 *
 * Champ par champ, comme `get` : ajouter une colonne à la table ne l'expose
 * plus par accident.
 */
export const getPrivate = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const settings = await ctx.db.query("settings").first()
    if (settings === null) return null
    return {
      _id: settings._id,
      _creationTime: settings._creationTime,
      siteName: settings.siteName,
      logoId: settings.logoId,
      iconId: settings.iconId,
      homePageSlug: settings.homePageSlug,
      defaultSeo: settings.defaultSeo,
      socials: settings.socials,
      // L'adresse, oui : elle traverse déjà des journaux et des captures
      // d'écran, ce n'est pas un secret — c'est précisément ce que la
      // signature existe pour compenser. Le SECRET, non.
      leadWebhookUrl: settings.leadWebhookUrl,
      leadWebhookLastStatus: settings.leadWebhookLastStatus,
      leadWebhookLastAt: settings.leadWebhookLastAt,
      // Déplacée depuis `get` (relecture finale, correctif 1) : c'est
      // l'adresse d'expédition du site, pas un secret, mais elle n'a rien
      // à faire dans une projection publique non authentifiée pour autant
      // — voir le commentaire de `get`. `null` plutôt qu'`undefined` :
      // Convex retire les champs `undefined` avant l'envoi, et un écran
      // qui teste `=== null` pour afficher un état « non réglé » a besoin
      // que le champ soit toujours présent dans la réponse.
      //
      // `/settings/emails` (`routes/_authed/settings/emails.tsx`) l'écrit,
      // par cette même mutation (`settings.update`) — jamais en sauvegarde
      // automatique, la barre attend un clic : une adresse à moitié tapée
      // ne doit jamais devenir, ne serait-ce qu'une seconde, l'expéditeur
      // de ce qui part.
      emailFrom: settings.emailFrom ?? null,
      // Même raisonnement qu'`emailFrom` juste au-dessus : ne pilote rien
      // côté site public, n'a donc rien à faire dans `get`. `null` et non
      // `undefined` — l'écran de vérification DNS doit pouvoir distinguer
      // « pas encore déclaré » de « la requête a échoué ».
      declaredDomain: settings.declaredDomain ?? null,
    }
  },
})

/**
 * Le secret de signature du webhook, en clair — et rien d'autre.
 *
 * Une query à part, `owner`/`admin` seulement. En clair parce que c'est un
 * secret PARTAGÉ : il n'a d'utilité que recopié dans le scénario n8n ou
 * Make qui vérifie la signature, donc un écran qui ne saurait que dire
 * « configuré » forcerait à en frapper un nouveau à chaque fois qu'on le
 * perd. C'est la différence avec les jetons de `secrets.ts`, qui ne sortent
 * jamais : ceux-là, personne n'a besoin de les relire.
 */
export const webhookSecret = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin"])
    const settings = await ctx.db.query("settings").first()
    return settings?.leadWebhookSecret ?? null
  },
})

/**
 * L'état des intégrations posées dans l'ENVIRONNEMENT du déploiement.
 *
 * Une clé d'API ne va pas en base, et il ne s'agit pas d'un goût
 * d'architecture : la table `settings` a une projection publique
 * (`get` ci-dessus), un jour quelqu'un y recopiera un champ de trop, et ce
 * jour-là une clé OpenRouter serait lisible par tout Internet. C'est
 * arrivé, une fois, pour le secret de signature du webhook. Les clés
 * vivent donc dans `npx convex env set`, où aucune query ne peut les
 * atteindre par accident.
 *
 * Mais un opérateur ne peut pas non plus deviner ce qu'il a posé il y a
 * trois mois sur un déploiement, et un écran qui n'en dit rien le laisse
 * chercher dans un terminal. D'où cette query : elle rend des BOOLÉENS,
 * jamais des valeurs. `settings.environment.test.ts` échoue si une valeur
 * de secret apparaît dans le résultat.
 *
 * Les trois chaînes qu'elle rend — les deux origines et l'URL d'Umami —
 * n'en sont pas : elles figurent dans la barre d'adresse de tout visiteur.
 *
 * Ce qu'elle NE PEUT PAS dire, et l'écran le dit à sa place : l'état des
 * variables `PUBLIC_*` d'`apps/web` (pixels, script Umami). Elles sont
 * figées au BUILD de l'image du site — Convex ne les voit pas, et n'a
 * aucun moyen de les voir.
 *
 * Mêmes rôles que `getPrivate` : des booléens et deux origines publiques,
 * rien qu'un editor ne puisse déjà lire ailleurs. Le fragment de valeur —
 * les quatre derniers caractères d'un jeton — est ailleurs
 * (`secrets.status`), et celui-là est réservé à owner/admin.
 */
export const environment = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const env = process.env
    const origines = deriverOrigines((await ctx.db.query("settings").first())?.declaredDomain, env)
    return {
      // Aucune fonction de ce dépôt ne lit encore cette clé : l'écran le
      // dit, plutôt que d'afficher une pastille verte pour une
      // fonctionnalité qui n'existe pas.
      openRouter: { configured: Boolean(env.OPENROUTER_API_KEY) },
      resend: {
        configured: Boolean(env.RESEND_API_KEY),
        // Même lecture que `lib/resend.ts` — `!== "false"` — et pas une
        // seconde interprétation écrite à côté : les deux divergeraient,
        // et l'écran annoncerait des envois réels là où rien ne part.
        testMode: env.RESEND_TEST_MODE !== "false",
      },
      // Les identifiants avec lesquels le dashboard LIT les statistiques,
      // et non le script qui les collecte : celui-là est une variable de
      // build d'`apps/web`, invisible d'ici.
      umamiApi: {
        configured: readUmamiConfig(env) !== null,
        url: readUmamiConfig(env)?.url ?? null,
        // Un lien de partage est un secret porteur ; on dit s'il existe,
        // jamais lequel (`analytics.umamiLinks` le compose côté serveur).
        shared: Boolean(env.UMAMI_API_SHARE_ID),
      },
      consentLog: { configured: Boolean(env.CONSENT_LOG_SECRET) },
      // Les deux origines EFFECTIVES, pas les variables d'environnement.
      // L'écran dit ce qui part réellement dans les emails : depuis que le
      // domaine déclaré l'emporte sur l'environnement (`lib/origines.ts`),
      // afficher `SITE_URL` telle quelle annoncerait une origine que plus
      // aucun lien n'utilise — le pire des deux affichages, parce qu'il a
      // l'air juste.
      /** L'origine du dashboard — celle des liens envoyés par email. */
      adminUrl: origines.admin,
      /** L'origine du site public — celle qu'on appelle pour invalider son cache. */
      webUrl: origines.web,
    }
  },
})

/**
 * The slug of the page served at `/`, or `null`.
 *
 * Split out from `get` so `index.astro` can ask the one question it has,
 * and so the answer is a stable, cacheable string rather than the whole
 * settings document.
 */
export const homePageSlug = query({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query("settings").first()
    return settings?.homePageSlug ?? null
  },
})

/** Lecture interne pour les actions d'envoi. Jamais publique : inutile au navigateur. */
export const expediteur = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("settings").first())?.emailFrom ?? null,
})

/**
 * Le domaine déclaré, BRUT, pour les actions qui composent un lien.
 *
 * `internalQuery` et non un champ de plus dans `get` : cette query-là est
 * publique et non authentifiée (invariant 1), et le domaine déclaré n'y
 * entre pas — même règle que `routing.hotes`, qui le lit derrière un
 * secret partagé.
 *
 * Rendue brute, non validée : la validation vit dans `deriverOrigines`
 * (`lib/origines.ts`), un seul endroit, et c'est lui qui décide du repli.
 * La normaliser ici ferait deux règles pour une seule question.
 */
export const domaineDeclare = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("settings").first())?.declaredDomain ?? null,
})

function assertLength(value: string, max: number, field: string): void {
  if (value.length > max) {
    throw new ConvexError({ code: "FIELD_TOO_LONG", field, max })
  }
}

/**
 * Deux valeurs de réglage sont-elles la même ?
 *
 * `===` ne suffit pas : `defaultSeo` est un objet et `socials` un tableau,
 * que le formulaire reconstruit à chaque envoi — deux références
 * différentes pour un contenu identique. Et `JSON.stringify` ne suffit pas
 * non plus, parce qu'il rend le résultat dépendant de l'ORDRE DES CLÉS, que
 * ni le formulaire ni la base ne garantissent : le jour où il change, tous
 * les envois se mettraient à déclarer un changement de SEO qui n'a pas eu
 * lieu — exactement le défaut que cette comparaison existe pour supprimer.
 *
 * `undefined === undefined` est vrai, et c'est voulu : effacer un champ
 * déjà absent ne change rien.
 */
function memeValeur(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => memeValeur(item, b[index]))
  }
  if (typeof a === "object" && typeof b === "object") {
    const clesA = Object.keys(a).sort()
    const clesB = Object.keys(b).sort()
    if (clesA.length !== clesB.length) return false
    if (clesA.some((cle, index) => cle !== clesB[index])) return false
    return clesA.every((cle) =>
      memeValeur((a as Record<string, unknown>)[cle], (b as Record<string, unknown>)[cle]),
    )
  }
  return false
}

export const update = mutation({
  args: {
    siteName: v.optional(v.string()),
    // `v.union(..., v.null())` et pas seulement `v.optional` : le client
    // Convex supprime les champs `undefined` avant l'envoi, donc il
    // n'existe aucune valeur qu'un formulaire puisse transmettre pour dire
    // « enlève le logo ». `null` est cette valeur ; elle est traduite en
    // `undefined` juste avant le patch, où elle efface bien le champ.
    logoId: v.optional(v.union(v.id("_storage"), v.null())),
    iconId: v.optional(v.union(v.id("_storage"), v.null())),
    // `null` efface le réglage ; absent le laisse tel quel. Sans les deux
    // formes, on ne pourrait jamais débrancher un webhook une fois posé.
    leadWebhookUrl: v.optional(v.union(v.string(), v.null())),
    leadWebhookSecret: v.optional(v.union(v.string(), v.null())),
    defaultSeo: v.optional(seoValidator),
    socials: v.optional(v.array(socialValidator)),
    // Pas de variante `| null` : comme `siteName`, il n'existe pas encore
    // d'écran qui envoie « efface ce champ ». Elle reste donc dans
    // `...rest` sans piéger `db.patch`.
    emailFrom: v.optional(v.string()),
    // `| null` explicite, comme `leadWebhookUrl` : absent veut dire « laisse
    // tel quel », `null` veut dire « efface ». Une chaîne vide serait la
    // troisième façon de dire l'une des deux, donc la source du prochain
    // malentendu.
    declaredDomain: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    // Site-wide settings are not an editor's call: the name, the logo and
    // the SEO defaults apply to every page at once.
    const acteur = await requireRole(ctx, ["owner", "admin"])

    if (args.siteName !== undefined) {
      const siteName = args.siteName.trim()
      assertLength(args.siteName, MAX_SITE_NAME_LENGTH, "siteName")
      if (siteName.length === 0) throw new ConvexError({ code: "INVALID_SITE_NAME" })
      args = { ...args, siteName }
    }

    if (args.socials !== undefined) {
      if (args.socials.length > MAX_SOCIALS) {
        throw new ConvexError({ code: "FIELD_TOO_MANY", field: "socials", max: MAX_SOCIALS })
      }
      for (const [index, social] of args.socials.entries()) {
        assertLength(social.label, MAX_SOCIAL_LABEL_LENGTH, `socials[${index}].label`)
        assertLength(social.url, MAX_SOCIAL_URL_LENGTH, `socials[${index}].url`)
      }
    }

    // Relecture finale, correctif 1 : une adresse malformée posée en CLI —
    // seul chemin à l'époque, avant que `/settings/emails` n'écrive ce
    // champ (voir `getPrivate`) — était acceptée en silence et ne se
    // révélait qu'à l'envoi, où
    // `choisirExpediteur` (`lib/expediteur.ts`) l'aurait de toute façon
    // rejetée en repliant sur le bac à sable Resend — mais alors sans que
    // personne ne l'ait décidé. Même validateur que `resoudreExpediteur`
    // utilise à l'envoi, pour qu'une adresse acceptée ici le reste là-bas.
    // Une chaîne vide n'est pas malformée : c'est l'absence de réglage.
    if (args.emailFrom !== undefined) {
      const emailFrom = args.emailFrom.trim()
      if (emailFrom.length > 0 && !estAdresseValide(emailFrom)) {
        throw new ConvexError({ code: "INVALID_EMAIL_FROM", field: "emailFrom" })
      }
      args = { ...args, emailFrom }
    }

    // Validé et normalisé AVANT l'extraction ci-dessous : un hôte refusé
    // doit faire échouer la mutation entière, pas seulement se voir écarté
    // en silence. `null` traverse tel quel — c'est « efface », pas une
    // valeur à normaliser.
    if (args.declaredDomain !== undefined && args.declaredDomain !== null) {
      const hote = normaliserHote(args.declaredDomain)
      if (hote === null) {
        throw new ConvexError({ code: "INVALID_DOMAIN", field: "declaredDomain" })
      }
      args = { ...args, declaredDomain: hote }
    }

    // `logoId` est extrait de l'étalement plutôt que réécrit par-dessus :
    // sinon le type du champ garde son `| null`, que `db.patch` refuse.
    // L'URL est vérifiée AVANT d'être écrite : une adresse interne posée
    // en base deviendrait une requête sortante à chaque lead, et le refus
    // arriverait alors trop tard pour servir à quoi que ce soit.
    if (args.leadWebhookUrl) {
      const refus = refuseWebhookUrl(args.leadWebhookUrl)
      if (refus !== null) throw new ConvexError({ code: refus, field: "leadWebhookUrl" })
    }

    // `leadWebhookSecret` est extrait ici aussi, sinon il reste dans
    // `...rest` avec son `| null` et `db.patch` le refuse — l'erreur pointe
    // alors le patch entier, pas le champ fautif.
    const {
      logoId,
      iconId,
      leadWebhookUrl,
      leadWebhookSecret: _ignore,
      declaredDomain,
      ...rest
    } = args
    void _ignore
    // `let` d'un type large : la valeur finale est calculée juste en
    // dessous, puis rétrécie explicitement avant d'entrer dans le patch —
    // `db.patch` n'accepte pas `null`, qui signifie ici « efface ».
    let leadWebhookSecret: string | null | undefined = args.leadWebhookSecret

    // Une URL sans secret ne signerait rien, et `deliverWebhook` refuserait
    // d'envoyer : le réglage aurait l'air posé et rien ne partirait, en
    // silence. Plutôt que d'exiger de l'opérateur qu'il invente une chaîne
    // aléatoire, on la frappe ici. Le pire des deux mondes serait d'envoyer
    // sans signature.
    if (leadWebhookUrl) {
      const existing = await ctx.db.query("settings").first()
      const dejaPose = leadWebhookSecret ?? existing?.leadWebhookSecret
      if (!dejaPose) {
        const bytes = crypto.getRandomValues(new Uint8Array(32))
        leadWebhookSecret = Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
      }
    }
    // Construit à part : dans un étalement conditionnel, TypeScript garde
    // le `null` du type d'origine et `db.patch` le refuse.
    const secretPatch: { leadWebhookSecret?: string | undefined } =
      leadWebhookSecret === undefined
        ? {}
        : { leadWebhookSecret: leadWebhookSecret ?? undefined }

    const patch = {
      ...rest,
      ...(logoId !== undefined ? { logoId: logoId ?? undefined } : {}),
      ...(iconId !== undefined ? { iconId: iconId ?? undefined } : {}),
      ...(leadWebhookUrl !== undefined
        ? { leadWebhookUrl: leadWebhookUrl ?? undefined }
        : {}),
      ...(declaredDomain !== undefined
        ? { declaredDomain: declaredDomain ?? undefined }
        : {}),
      ...secretPatch,
    }

    const existing = await ctx.db.query("settings").first()

    // Ce qui a RÉELLEMENT changé, et non ce qui a été soumis.
    //
    // Les écrans envoient toujours le formulaire entier : `identite.tsx`
    // renvoie `{ siteName, logoId, iconId }` à chaque pause de frappe
    // (sauvegarde automatique, 1,5 s), et `webhook.tsx` renvoie toujours
    // l'URL ET le secret. Nommer les champs soumis faisait donc dire au
    // journal, à chaque renommage du site, que le logo avait changé — et à
    // chaque correction d'URL, que le secret de signature avait été
    // remplacé. Une ligne qui affirme un geste qui n'a pas eu lieu rend le
    // journal FAUX, ce qui est pire qu'incomplet, et le champ accusé à tort
    // était le plus sensible de la table.
    //
    // Les noms, jamais les valeurs : le journal dit que le secret a changé,
    // il ne dit pas ce qu'il vaut.
    const avant = existing as Record<string, unknown> | null
    const champsModifies = Object.keys(patch)
      .filter((champ) => !memeValeur(avant?.[champ], (patch as Record<string, unknown>)[champ]))
      .sort()

    // Dans la même mutation que l'écriture — voir `lib/auditEvent.ts`. Rien
    // n'est écrit quand rien n'a changé : une sauvegarde automatique qui
    // repasse les mêmes valeurs n'est pas un geste.
    if (champsModifies.length > 0) {
      await journaliser(ctx, {
        acteur,
        action: "settings.update",
        detail: champsModifies.join(", "),
      })
    }
    // L'hôte web qui vient de cesser d'être le courant — noté à part du
    // patch, et volontairement APRÈS `champsModifies`.
    //
    // Hors du journal parce que ce n'est pas un geste : personne ne
    // « modifie les hôtes sortants », c'est une conséquence mécanique du
    // changement de domaine, que la ligne `declaredDomain` du journal dit
    // déjà. L'y ajouter ferait dire au journal deux fois la même chose,
    // dont une fois avec un nom que l'opérateur ne reconnaîtrait pas.
    const patchSortants = sortantsApresChangement(existing, declaredDomain)

    if (existing) {
      await ctx.db.patch(existing._id, { ...patch, ...patchSortants })
      return existing._id
    }
    // Upsert rather than requiring a separate "initialise" step: a freshly
    // cloned template has no row, and the first save should just work.
    return ctx.db.insert("settings", { siteName: "Mon site", ...patch, ...patchSortants })
  },
})

/**
 * Ce que devient `previousDomains` quand le domaine déclaré change.
 *
 * Le raisonnement, la fenêtre et le plafond vivent dans
 * `lib/hotesSortants.ts` ; ici il n'y a que la question « quel hôte web
 * était en vigueur juste avant, et est-il différent de celui d'après ».
 *
 * Deux points décident de la forme :
 *
 * 1. **On note l'hôte EFFECTIF, pas le domaine déclaré.** La première
 *    déclaration d'un domaine sur un déploiement neuf est un changement
 *    comme un autre : l'hôte en vigueur était `WEB_DOMAIN`, et c'est lui
 *    qui reçoit encore le trafic pendant la bascule. Ne noter que les
 *    `declaredDomain` remplacés laisserait précisément le premier
 *    changement — celui de l'adoptant qui arrive — sans filet. Effacer le
 *    domaine déclaré (`null`) est le mouvement inverse et se note de la
 *    même façon.
 *
 * 2. **C'est un « au mieux », et il faut le savoir.** `settings.update`
 *    n'est pas le seul chemin d'écriture de `declaredDomain` (migration,
 *    `npx convex run`, restauration de sauvegarde) : un domaine changé
 *    par l'un d'eux ne laisse aucun sortant derrière lui. L'échec reste
 *    FERMÉ — pas de sortant veut dire « on n'honore pas l'en-tête »,
 *    c'est-à-dire le comportement d'avant ce champ.
 *
 * `WEB_DOMAIN` est lu ici en toutes lettres : `scripts/check-env-wiring.mjs`
 * ne reconnaît qu'un accès littéral, et un accès calculé lui échapperait.
 */
function sortantsApresChangement(
  existing: { declaredDomain?: string; previousDomains?: HoteSortant[] } | null,
  declaredDomain: string | null | undefined,
): { previousDomains?: HoteSortant[] } {
  // `undefined` veut dire « le formulaire ne parlait pas du domaine ». Rien
  // n'a bougé, donc rien à noter — et surtout pas d'élagage opportuniste :
  // une sauvegarde automatique de `/settings/identite` ne doit pas faire
  // expirer un sortant en avance.
  if (declaredDomain === undefined) return {}

  const repli = normaliserHote(process.env.WEB_DOMAIN ?? "")
  const avant = normaliserHote(existing?.declaredDomain ?? "") ?? repli
  const apres = declaredDomain === null ? repli : normaliserHote(declaredDomain)
  if (avant === null || avant === apres) return {}

  return { previousDomains: noterSortie(existing?.previousDomains, avant, Date.now()) }
}

/**
 * Choose which page answers at `/`.
 *
 * Stored as a slug rather than a document id, on purpose: `index.astro`
 * looks the page up by slug like every other route, so there is one lookup
 * path rather than two. The cost is that renaming a page's slug leaves this
 * pointing at nothing — which `pages.update` handles by following the
 * rename, so the home page stays the home page.
 *
 * `null` clears it, and `/` falls back to rendering nothing in particular
 * rather than erroring.
 */
export const setHomePage = mutation({
  args: { slug: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])

    if (args.slug !== null) {
      const page = await ctx.db
        .query("pages")
        .withIndex("by_slug", (q) => q.eq("slug", args.slug as string))
        .unique()
      // Pointing `/` at a page that does not exist would 404 the site's
      // front door, and the dashboard would show no sign of why.
      if (page === null) throw new ConvexError({ code: "UNKNOWN_PAGE", slug: args.slug })
    }

    const existing = await ctx.db.query("settings").first()
    if (existing) {
      await ctx.db.patch(existing._id, { homePageSlug: args.slug ?? undefined })
      return existing._id
    }
    return ctx.db.insert("settings", {
      siteName: "Mon site",
      homePageSlug: args.slug ?? undefined,
    })
  },
})

MUTATION_REGISTRY.push(
  {
    name: "settings.update",
    allowedRoles: ["owner", "admin"],
    invoke: (t) => t.mutation(api.settings.update, { siteName: "Registry site" }),
  },
  {
    name: "settings.setHomePage",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const slug = `registry-home-${Date.now()}-${Math.random()}`
      await t.mutation(api.pages.create, { title: "Registry home", slug })
      return t.mutation(api.settings.setHomePage, { slug })
    },
  }
)

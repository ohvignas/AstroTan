import { ConvexError, v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { api } from "./_generated/api"
import {
  MAX_SITE_NAME_LENGTH,
  MAX_SOCIALS,
  MAX_SOCIAL_LABEL_LENGTH,
  MAX_SOCIAL_URL_LENGTH,
  seoValidator,
} from "./content"
import { requireRole } from "./lib/authz"
import { readUmamiConfig } from "./lib/umamiToken"
import { refuseWebhookUrl } from "./lib/webhookUrl"
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
// page. Nothing secret goes in this table — if a field ever needs a session
// to read, it belongs somewhere else.

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
    }
  },
})

/**
 * La ligne entière, pour le dashboard.
 *
 * Séparée de `get` parce que les deux publics n'ont pas les mêmes droits :
 * celle-ci exige un rôle, et c'est elle qui porte les secrets.
 */
export const getPrivate = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    return ctx.db.query("settings").first()
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
 * Mêmes rôles que `getPrivate`, à dessein : celle-ci rend strictement
 * moins que celle-là, qui donne déjà la ligne entière (secret du webhook
 * compris) à un editor. Plus restrictive ici, l'écran des réglages
 * n'aurait plus rien à montrer à qui a pourtant le droit de le consulter.
 */
export const environment = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const env = process.env
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
      /** L'origine du dashboard — celle des liens envoyés par email. */
      adminUrl: env.SITE_URL ?? null,
      /** L'origine du site public — celle qu'on appelle pour invalider son cache. */
      webUrl: env.WEB_SITE_URL ?? null,
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

function assertLength(value: string, max: number, field: string): void {
  if (value.length > max) {
    throw new ConvexError({ code: "FIELD_TOO_LONG", field, max })
  }
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
  },
  handler: async (ctx, args) => {
    // Site-wide settings are not an editor's call: the name, the logo and
    // the SEO defaults apply to every page at once.
    await requireRole(ctx, ["owner", "admin"])

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
    const { logoId, iconId, leadWebhookUrl, leadWebhookSecret: _ignore, ...rest } = args
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
      ...secretPatch,
    }

    const existing = await ctx.db.query("settings").first()
    if (existing) {
      await ctx.db.patch(existing._id, patch)
      return existing._id
    }
    // Upsert rather than requiring a separate "initialise" step: a freshly
    // cloned template has no row, and the first save should just work.
    return ctx.db.insert("settings", { siteName: "Mon site", ...patch })
  },
})

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

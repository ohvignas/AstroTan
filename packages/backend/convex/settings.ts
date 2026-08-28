import { ConvexError, v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { api } from "./_generated/api"
import { seoValidator } from "./content"
import { requireRole } from "./lib/authz"
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

export const MAX_SITE_NAME_LENGTH = 100
export const MAX_SOCIAL_LABEL_LENGTH = 40
export const MAX_SOCIAL_URL_LENGTH = 2048
export const MAX_SOCIALS = 10

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
export const get = query({
  args: {},
  handler: async (ctx) => ctx.db.query("settings").first(),
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
    logoId: v.optional(v.id("_storage")),
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

    const existing = await ctx.db.query("settings").first()
    if (existing) {
      await ctx.db.patch(existing._id, args)
      return existing._id
    }
    // Upsert rather than requiring a separate "initialise" step: a freshly
    // cloned template has no row, and the first save should just work.
    return ctx.db.insert("settings", { siteName: "Mon site", ...args })
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

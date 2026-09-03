import { ConvexError, v } from "convex/values"
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { api, internal } from "./_generated/api"
import "./lib/connectorsRegistry"
import {
  MAX_GOOGLE_CALENDAR_EMAIL,
  MAX_GOOGLE_CALENDAR_ID,
  MAX_GOOGLE_CLIENT_ID,
} from "./content"
import { requireRole } from "./lib/authz"
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode as exchangeAuthorizationCode,
  readPrimaryCalendarEmail,
  sourceDuNom,
} from "./lib/googleOAuth"
import { chiffrer, lireCleMaitresse, SECRETS_KEY_COMMANDE } from "./lib/secretsCrypto"
import { lireSecret } from "./secrets"

function assertLength(value: string, max: number, field: string): void {
  if (value.length > max) throw new ConvexError({ code: "FIELD_TOO_LONG", field, max })
}

export const googleConfig = internalQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query("settings").first()
    return {
      clientId: settings?.googleCalendarClientId ?? null,
      calendarId: settings?.googleCalendarId?.trim() || "primary",
    }
  },
})

export const googleAuthUrl = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin"])
    const settings = await ctx.db.query("settings").first()
    const clientId = settings?.googleCalendarClientId?.trim() ?? ""
    const origin = process.env.SITE_URL
    if (clientId.length === 0 || !origin) {
      throw new ConvexError({ code: "CALENDAR_DISCONNECTED" })
    }
    const redirect = `${origin.replace(/\/$/, "")}/api/connectors/google/callback`
    return { url: buildGoogleAuthUrl(clientId, redirect) }
  },
})

export const googleStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin"])
    const settings = await ctx.db.query("settings").first()
    const secretRow = await ctx.db
      .query("secrets")
      .withIndex("by_nom", (q) => q.eq("nom", "GOOGLE_CALENDAR_CLIENT_SECRET"))
      .unique()
    const refreshRow = await ctx.db
      .query("secrets")
      .withIndex("by_nom", (q) => q.eq("nom", "GOOGLE_CALENDAR_REFRESH_TOKEN"))
      .unique()
    const refresh = sourceDuNom("GOOGLE_CALENDAR_REFRESH_TOKEN", refreshRow !== null)
    const secret = sourceDuNom("GOOGLE_CALENDAR_CLIENT_SECRET", secretRow !== null)
    const clientId = settings?.googleCalendarClientId?.trim() ?? ""
    return {
      connected: refresh !== "aucune",
      ready: clientId.length > 0 && secret !== "aucune",
      email: settings?.googleCalendarEmail?.trim() || null,
      refreshSource: refresh,
      calendarId: settings?.googleCalendarId?.trim() || "primary",
    }
  },
})

export const updateGoogle = mutation({
  args: {
    googleCalendarClientId: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["owner", "admin"])
    if (args.googleCalendarClientId !== undefined) {
      assertLength(args.googleCalendarClientId, MAX_GOOGLE_CLIENT_ID, "googleCalendarClientId")
    }
    if (args.googleCalendarId !== undefined) {
      assertLength(args.googleCalendarId, MAX_GOOGLE_CALENDAR_ID, "googleCalendarId")
    }
    const patch = {
      ...(args.googleCalendarClientId !== undefined
        ? { googleCalendarClientId: args.googleCalendarClientId }
        : {}),
      ...(args.googleCalendarId !== undefined ? { googleCalendarId: args.googleCalendarId } : {}),
    }
    const existing = await ctx.db.query("settings").first()
    if (existing) {
      await ctx.db.patch(existing._id, patch)
      return existing._id
    }
    return ctx.db.insert("settings", { siteName: "Mon site", ...patch })
  },
})

export const storeGoogleRefresh = action({
  args: { refreshToken: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const acteur = await requireRole(ctx, ["owner", "admin"])
    const valeur = args.refreshToken.trim()
    if (valeur.length === 0) throw new ConvexError({ code: "EMPTY_SECRET" })
    const cle = lireCleMaitresse(process.env)
    if (!cle.ok) {
      throw new ConvexError({
        code: cle.raison === "MISSING" ? "SECRETS_KEY_MISSING" : "SECRETS_KEY_MALFORMED",
        commande: SECRETS_KEY_COMMANDE,
      })
    }
    const { iv, chiffre } = await chiffrer(cle.octets, valeur)
    await ctx.runMutation(internal.secrets.ranger, {
      nom: "GOOGLE_CALENDAR_REFRESH_TOKEN",
      iv,
      chiffre,
      majPar: acteur._id,
      majParEmail: acteur.email,
    })
    return null
  },
})

export const rangerEmail = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim()
    if (email.length > MAX_GOOGLE_CALENDAR_EMAIL) {
      throw new ConvexError({
        code: "FIELD_TOO_LONG",
        field: "googleCalendarEmail",
        max: MAX_GOOGLE_CALENDAR_EMAIL,
      })
    }
    const settings = await ctx.db.query("settings").first()
    const value = email.length === 0 ? undefined : email
    if (settings) {
      await ctx.db.patch(settings._id, { googleCalendarEmail: value })
      return settings._id
    }
    return ctx.db.insert("settings", { siteName: "Mon site", googleCalendarEmail: value })
  },
})

export const disconnectGoogle = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["owner", "admin"])
    const row = await ctx.db
      .query("secrets")
      .withIndex("by_nom", (q) => q.eq("nom", "GOOGLE_CALENDAR_REFRESH_TOKEN"))
      .unique()
    if (row !== null) await ctx.db.delete(row._id)
    const settings = await ctx.db.query("settings").first()
    if (settings) await ctx.db.patch(settings._id, { googleCalendarEmail: undefined })
    return null
  },
})

export const exchangeGoogleCode = action({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await requireRole(ctx, ["owner", "admin"])
    const secret = await lireSecret(ctx, "GOOGLE_CALENDAR_CLIENT_SECRET")
    const config = await ctx.runQuery(internal.connectors.googleConfig, {})
    const origin = process.env.SITE_URL
    if (!secret || !config.clientId || !origin) {
      throw new ConvexError({ code: "CALENDAR_DISCONNECTED" })
    }
    const redirect = `${origin.replace(/\/$/, "")}/api/connectors/google/callback`
    const tokens = await exchangeAuthorizationCode({
      code: args.code,
      clientId: config.clientId,
      clientSecret: secret,
      redirectUri: redirect,
    })
    await ctx.runAction(api.connectors.storeGoogleRefresh, { refreshToken: tokens.refreshToken })
    if (tokens.accessToken) {
      const email = await readPrimaryCalendarEmail(tokens.accessToken)
      await ctx.runMutation(internal.connectors.rangerEmail, { email: email ?? "" })
    }
    return null
  },
})

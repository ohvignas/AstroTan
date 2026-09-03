import { ConvexError, v } from "convex/values"
import { action, internalMutation, internalQuery } from "./_generated/server"
import { internal } from "./_generated/api"
import "./lib/mcpOAuthRegistry"
import {
  MCP_OAUTH_TTL_MS,
  buildMcpAuthorizeUrl,
  discoverMcpOAuth,
  exchangeMcpAuthorizationCode,
  expiresAtFromExpiresIn,
  generatePkce,
  generateState,
  mcpOAuthRedirectUri,
  parseOauthSessionPayload,
  registerMcpClient,
  serializeMcpSecretPayload,
} from "./lib/mcpOAuth"
import { requireRole } from "./lib/authz"
import { chiffrer, dechiffrer, lireCleMaitresse, SECRETS_KEY_COMMANDE } from "./lib/secretsCrypto"

function oauthRefuse(code = "MCP_OAUTH"): never {
  throw new ConvexError({ code })
}

export const getServer = internalQuery({
  args: { id: v.id("mcpServers") },
  handler: async (ctx, args) => ctx.db.get(args.id),
})

export const byOauthState = internalQuery({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("mcpServers")
      .withIndex("by_oauth_state", (q) => q.eq("oauthState", args.state))
      .unique()
  },
})

export const rangerOauth = internalMutation({
  args: {
    id: v.id("mcpServers"),
    state: v.string(),
    iv: v.bytes(),
    chiffre: v.bytes(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      oauthState: args.state,
      oauthIv: args.iv,
      oauthChiffre: args.chiffre,
      oauthExpiresAt: args.expiresAt,
    })
    return null
  },
})

export const clearOauth = internalMutation({
  args: { id: v.id("mcpServers") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      oauthState: undefined,
      oauthIv: undefined,
      oauthChiffre: undefined,
      oauthExpiresAt: undefined,
    })
    return null
  },
})

export const beginAuthorize = action({
  args: { id: v.id("mcpServers") },
  handler: async (ctx, args): Promise<{ url: string }> => {
    await requireRole(ctx, ["owner", "admin"])
    const server = await ctx.runQuery(internal.mcpOAuth.getServer, { id: args.id })
    if (server === null) oauthRefuse("NOT_FOUND")
    const origin = process.env.SITE_URL?.trim()
    if (!origin) oauthRefuse()
    const cle = lireCleMaitresse(process.env)
    if (!cle.ok) {
      throw new ConvexError({
        code: cle.raison === "MISSING" ? "SECRETS_KEY_MISSING" : "SECRETS_KEY_MALFORMED",
        commande: SECRETS_KEY_COMMANDE,
      })
    }
    let discovered: Awaited<ReturnType<typeof discoverMcpOAuth>>
    try {
      discovered = await discoverMcpOAuth(server.url)
    } catch {
      oauthRefuse()
    }
    if (!discovered.registrationEndpoint) oauthRefuse()
    const redirectUri = mcpOAuthRedirectUri(origin)
    let client: Awaited<ReturnType<typeof registerMcpClient>>
    try {
      client = await registerMcpClient({
        registrationEndpoint: discovered.registrationEndpoint,
        redirectUri,
        clientName: "AstroTan",
        tokenEndpointAuthMethod: discovered.tokenEndpointAuthMethod,
      })
    } catch {
      oauthRefuse()
    }
    const { verifier, challenge } = await generatePkce()
    const state = generateState()
    const { iv, chiffre } = await chiffrer(
      cle.octets,
      JSON.stringify({
        verifier,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        tokenEndpoint: discovered.tokenEndpoint,
        redirectUri,
        resource: discovered.resource,
      }),
    )
    await ctx.runMutation(internal.mcpOAuth.rangerOauth, {
      id: args.id,
      state,
      iv,
      chiffre,
      expiresAt: Date.now() + MCP_OAUTH_TTL_MS,
    })
    return {
      url: buildMcpAuthorizeUrl({
        authorizationEndpoint: discovered.authorizationEndpoint,
        clientId: client.clientId,
        redirectUri,
        state,
        codeChallenge: challenge,
        resource: discovered.resource,
        scope: discovered.scope,
      }),
    }
  },
})

export const exchangeCode = action({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const acteur = await requireRole(ctx, ["owner", "admin"])
    const server = await ctx.runQuery(internal.mcpOAuth.byOauthState, {
      state: args.state.trim(),
    })
    if (server === null || server.createdBy !== acteur._id) oauthRefuse("MCP_OAUTH_STATE")
    if (!server.oauthIv || !server.oauthChiffre) oauthRefuse("MCP_OAUTH_STATE")
    if ((server.oauthExpiresAt ?? 0) < Date.now()) oauthRefuse("MCP_OAUTH_STATE")
    const cle = lireCleMaitresse(process.env)
    if (!cle.ok) {
      throw new ConvexError({
        code: cle.raison === "MISSING" ? "SECRETS_KEY_MISSING" : "SECRETS_KEY_MALFORMED",
        commande: SECRETS_KEY_COMMANDE,
      })
    }
    const payload = parseOauthSessionPayload(
      await dechiffrer(cle.octets, server.oauthIv, server.oauthChiffre),
    )
    if (payload === null) oauthRefuse("MCP_OAUTH_STATE")
    let tokens: Awaited<ReturnType<typeof exchangeMcpAuthorizationCode>>
    try {
      tokens = await exchangeMcpAuthorizationCode({
        tokenEndpoint: payload.tokenEndpoint,
        code: args.code,
        clientId: payload.clientId,
        clientSecret: payload.clientSecret,
        redirectUri: payload.redirectUri,
        verifier: payload.verifier,
        resource: payload.resource,
      })
    } catch {
      oauthRefuse()
    }
    const { iv, chiffre } = await chiffrer(
      cle.octets,
      serializeMcpSecretPayload({
        accessToken: tokens.accessToken,
        oauth: {
          refreshToken: tokens.refreshToken,
          expiresAt: expiresAtFromExpiresIn(tokens.expiresIn),
          tokenEndpoint: payload.tokenEndpoint,
          clientId: payload.clientId,
          clientSecret: payload.clientSecret,
          resource: payload.resource,
        },
      }),
    )
    await ctx.runMutation(internal.mcpServers.rangerHeaders, {
      serverId: server._id,
      iv,
      chiffre,
      majPar: acteur._id,
    })
    await ctx.runMutation(internal.mcpOAuth.clearOauth, { id: server._id })
    return null
  },
})

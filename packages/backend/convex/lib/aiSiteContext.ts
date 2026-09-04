import type { ActionCtx } from "../_generated/server"
import { api } from "../_generated/api"
import { resolveSocialNetwork, socialLabel } from "./socialNetworks"

export type SiteContexte = {
  siteName?: string
  homePageSlug?: string
  webOrigin?: string
  declaredDomain?: string
  defaultSeoTitle?: string
  defaultSeoDescription?: string
  serpLocationCode?: number
  serpLanguageCode?: string
  socials?: string[]
}

export async function contexteSite(ctx: ActionCtx): Promise<SiteContexte> {
  const settings = await ctx.runQuery(api.settings.get, {})
  const privee = await ctx.runQuery(api.settings.getPrivate, {})
  const webOrigin = process.env.WEB_SITE_URL
  return {
    siteName: settings?.siteName,
    homePageSlug: settings?.homePageSlug,
    webOrigin: webOrigin && webOrigin.length > 0 ? webOrigin : undefined,
    declaredDomain: privee?.declaredDomain ?? undefined,
    defaultSeoTitle: settings?.defaultSeo?.title,
    defaultSeoDescription: settings?.defaultSeo?.description,
    serpLocationCode: privee?.serpLocationCode ?? undefined,
    serpLanguageCode: privee?.serpLanguageCode ?? undefined,
    socials: settings?.socials?.map((s) => {
      const id = resolveSocialNetwork(s.label)
      return id ? socialLabel(id) : s.label
    }),
  }
}

export function siteBits(site: SiteContexte) {
  return {
    siteName: site.siteName,
    homePageSlug: site.homePageSlug,
    declaredDomain: site.declaredDomain,
    defaultSeoTitle: site.defaultSeoTitle,
    defaultSeoDescription: site.defaultSeoDescription,
    serpLocationCode: site.serpLocationCode,
    serpLanguageCode: site.serpLanguageCode,
    socials: site.socials,
  }
}

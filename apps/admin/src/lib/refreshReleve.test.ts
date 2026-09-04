import { describe, expect, test } from "vitest"
import type { SiteSummary } from "@astrotan/backend/convex/analytics"
import {
  CYCLE_MS,
  MOTS_AUDIENCE,
  MOTS_RELEVE,
  dateDonneesAffichees,
  estOrigineLocale,
  estThrottleReleve,
  executerRefresh,
  formatRefreshAt,
  messageRefreshEchec,
  motEnCours,
  hoteJumeauWww,
  origineCibleRefresh,
  origineCibleStats,
  raisonReleveInactif,
  snapshotStatsVide,
} from "./refreshReleve"
import { RELEVER_THROTTLE_MS } from "@astrotan/backend/convex/lib/seoRankState"
import type { DocumentRank } from "@astrotan/backend/convex/lib/seoRankState"

const NOW = Date.UTC(2026, 8, 1, 12, 0, 0)

describe("formatRefreshAt", () => {
  test("moins d'une minute : à l'instant", () => {
    expect(formatRefreshAt(NOW - 20_000, NOW)).toBe("à l'instant")
  })

  test("moins de 24 h : relatif court", () => {
    expect(formatRefreshAt(NOW - 3 * 60_000, NOW)).toBe("il y a 3 min")
    expect(formatRefreshAt(NOW - 2 * 3_600_000, NOW)).toBe("il y a 2 h")
  })

  test("au-delà de 24 h : date courte FR", () => {
    expect(formatRefreshAt(Date.UTC(2026, 7, 20, 9, 0, 0), NOW)).toMatch(/20/)
    expect(formatRefreshAt(Date.UTC(2026, 7, 20, 9, 0, 0), NOW)).not.toContain(
      "il y a",
    )
  })
})

describe("motEnCours", () => {
  test("un seul mot visible, qui avance tous les 800 ms", () => {
    expect(motEnCours(MOTS_RELEVE, 0)).toBe("Recherche")
    expect(motEnCours(MOTS_RELEVE, CYCLE_MS - 1)).toBe("Recherche")
    expect(motEnCours(MOTS_RELEVE, CYCLE_MS)).toBe("Analyse")
    expect(motEnCours(MOTS_RELEVE, CYCLE_MS * 2)).toBe("Positions")
    expect(motEnCours(MOTS_RELEVE, CYCLE_MS * 3)).toBe("Recherche")
  })

  test("les mots audience restent distincts du relevé SEO", () => {
    expect(MOTS_AUDIENCE).toContain("Mesure")
    expect(motEnCours(MOTS_AUDIENCE, 0)).toBe("Mesure")
  })
})

describe("raisonReleveInactif", () => {
  test("rien quand canRelever", () => {
    expect(
      raisonReleveInactif({ state: "ranked", position: 4, canRelever: true }),
    ).toBeUndefined()
  })

  test("throttle : titre si le dernier fetchedAt a moins d'une heure", () => {
    const rank: DocumentRank = {
      state: "ranked",
      position: 4,
      canRelever: false,
      fetchedAt: NOW - RELEVER_THROTTLE_MS + 60_000,
    }
    expect(raisonReleveInactif(rank, NOW)).toBe(
      "Déjà relevé il y a moins d'une heure.",
    )
  })

  test("sans mot-clé ou sans DataForSEO : le dit", () => {
    expect(
      raisonReleveInactif({ state: "no_keyword", canRelever: false }, NOW),
    ).toBe("Aucun mot-clé cible.")
    expect(
      raisonReleveInactif({ state: "dfs_absent", canRelever: false }, NOW),
    ).toBe("DataForSEO n'est pas configuré.")
  })
})

describe("estThrottleReleve", () => {
  test("jamais relevé : pas de frein, même si canRelever est faux", () => {
    expect(
      estThrottleReleve({ state: "never_ranked", canRelever: false }, NOW),
    ).toBe(false)
    expect(estThrottleReleve(undefined, NOW)).toBe(false)
  })

  test("fetchedAt de moins d'une heure : frein", () => {
    expect(
      estThrottleReleve(
        {
          state: "ranked",
          position: 4,
          canRelever: false,
          fetchedAt: NOW - RELEVER_THROTTLE_MS + 60_000,
        },
        NOW,
      ),
    ).toBe(true)
  })
})

describe("origineCibleRefresh", () => {
  const LOCAL = "http://localhost:4321"
  const ADMIN = "http://localhost:3001"

  test("en DEV, un domaine public n'est pas ce poste : WEB_SITE_URL", () => {
    expect(
      origineCibleRefresh({
        declaredDomain: "agence-dupont.fr",
        webSiteUrl: LOCAL,
        isDev: true,
      }),
    ).toBe(LOCAL)
  })

  test("en DEV, jamais l'origine de l'admin", () => {
    expect(
      origineCibleRefresh({
        declaredDomain: "agence-dupont.fr",
        webSiteUrl: ADMIN,
        isDev: true,
      }),
    ).toBeNull()
    expect(estOrigineLocale(ADMIN)).toBe(true)
  })

  test("hors DEV, le domaine déclaré est l'origine publique", () => {
    expect(
      origineCibleRefresh({
        declaredDomain: "exemple.fr",
        webSiteUrl: LOCAL,
        isDev: false,
      }),
    ).toBe("https://exemple.fr")
  })

  test("sans domaine déclaré : WEB_SITE_URL, pas l'admin", () => {
    expect(
      origineCibleRefresh({
        declaredDomain: null,
        webSiteUrl: LOCAL,
        isDev: false,
      }),
    ).toBe(LOCAL)
  })
})

describe("hoteJumeauWww", () => {
  test("apex ↔ www, sans inventer un autre domaine", () => {
    expect(hoteJumeauWww("exemple.fr")).toBe("www.exemple.fr")
    expect(hoteJumeauWww("www.exemple.fr")).toBe("exemple.fr")
  })
})

describe("snapshotStatsVide", () => {
  test("0 mot-clé et 0 backlink : vide, on essaie l'autre hôte", () => {
    expect(snapshotStatsVide([], { backlinks: 0, referringDomains: 0 })).toBe(true)
    expect(snapshotStatsVide([], null)).toBe(true)
  })

  test("un mot-clé ou un backlink : pas vide", () => {
    expect(
      snapshotStatsVide([{ keyword: "x", position: 1, url: "https://exemple.fr/" }], null),
    ).toBe(false)
    expect(snapshotStatsVide([], { backlinks: 81, referringDomains: 54 })).toBe(false)
  })
})

describe("origineCibleStats", () => {
  const LOCAL = "http://localhost:4321"

  test("le domaine déclaré l'emporte, même en DEV", () => {
    expect(
      origineCibleStats({
        declaredDomain: "agence-dupont.fr",
        webSiteUrl: LOCAL,
      }),
    ).toBe("https://agence-dupont.fr")
  })

  test("sans domaine déclaré : WEB_SITE_URL, pas l'admin", () => {
    expect(
      origineCibleStats({
        declaredDomain: null,
        webSiteUrl: LOCAL,
      }),
    ).toBe(LOCAL)
    expect(
      origineCibleStats({
        declaredDomain: null,
        webSiteUrl: "http://localhost:3001",
      }),
    ).toBeNull()
  })
})

describe("dateDonneesAffichees", () => {
  test("prend le plus récent des timestamps réels, sans inventer maintenant", () => {
    expect(
      dateDonneesAffichees({ umamiFetchedAt: 100, seoFetchedAt: 250 }),
    ).toBe(250)
    expect(dateDonneesAffichees({ umamiFetchedAt: 100, seoFetchedAt: null })).toBe(
      100,
    )
    expect(dateDonneesAffichees({ seoFetchedAt: 80 })).toBe(80)
  })

  test("rien en base : undefined, pas Date.now()", () => {
    const before = Date.now()
    expect(
      dateDonneesAffichees({ umamiFetchedAt: null, seoFetchedAt: null }),
    ).toBeUndefined()
    expect(dateDonneesAffichees({})).toBeUndefined()
    expect(Date.now()).toBeGreaterThanOrEqual(before)
  })
})

describe("messageRefreshEchec", () => {
  test("chaque échec a une phrase FR", () => {
    expect(messageRefreshEchec("umami")).toMatch(/audience/i)
    expect(messageRefreshEchec("seo")).toMatch(/relevé|positions/i)
    expect(messageRefreshEchec("seo-keywords")).toMatch(/mots-clés/i)
    expect(messageRefreshEchec("seo-backlinks")).toMatch(/backlinks/i)
    expect(messageRefreshEchec("site", "https://exemple.fr")).toContain("exemple.fr")
    expect(messageRefreshEchec("reseau")).toMatch(/Réessayez/)
  })
})

describe("executerRefresh", () => {
  const ok: SiteSummary = {
    periode: "mois",
    unit: "day",
    startAt: 1,
    endAt: 2,
    totals: null,
    series: null,
    topPages: null,
    topReferrers: null,
    status: "ok",
    fetchedAt: 2,
  }

  test("Umami ok et site ok : pas d'erreur", async () => {
    const { error } = await executerRefresh({
      periode: "mois",
      chargerAudience: async () => ok,
      invaliderSite: async () => ({ ok: true, origin: "http://localhost:4321" }),
    })
    expect(error).toBeNull()
  })

  test("appelle le relevé site (DataForSEO) en plus d'Umami", async () => {
    let releve = 0
    const { error } = await executerRefresh({
      periode: "mois",
      chargerAudience: async () => ok,
      releverSite: async () => {
        releve += 1
        return { ok: true, fetchedAt: 99 }
      },
    })
    expect(releve).toBe(1)
    expect(error).toBeNull()
  })

  test("relevé SEO muet : phrase positions, pas un silence", async () => {
    const { error } = await executerRefresh({
      periode: "mois",
      chargerAudience: async () => ok,
      releverSite: async () => ({ ok: false, reason: "unreachable" }),
    })
    expect(error).toMatch(/relevé|positions/)
  })

  test("Labs raté : phrase mots-clés, pas un succès Umami", async () => {
    const { error } = await executerRefresh({
      periode: "mois",
      chargerAudience: async () => ok,
      releverSite: async () => ({ ok: false, reason: "keywords" }),
    })
    expect(error).toMatch(/mots-clés/)
  })

  test("Overview raté : phrase backlinks, pas un succès Umami", async () => {
    const { error } = await executerRefresh({
      periode: "mois",
      chargerAudience: async () => ok,
      releverSite: async () => ({ ok: false, reason: "backlinks" }),
    })
    expect(error).toMatch(/backlinks/)
  })

  test("DataForSEO absent : pas une erreur, le clic reste un succès Umami", async () => {
    const { error } = await executerRefresh({
      periode: "mois",
      chargerAudience: async () => ok,
      releverSite: async () => ({ ok: true, skipped: "dfs_absent" }),
    })
    expect(error).toBeNull()
  })

  test("Umami muet : phrase audience, pas un silence", async () => {
    const { error } = await executerRefresh({
      periode: "mois",
      chargerAudience: async () => ({ ...ok, status: "unreachable" }),
    })
    expect(error).toMatch(/audience/)
  })

  test("site public mort : la phrase cite l'origine", async () => {
    const { error } = await executerRefresh({
      periode: "mois",
      chargerAudience: async () => ok,
      invaliderSite: async () => ({ ok: false, origin: "https://exemple.fr" }),
    })
    expect(error).toContain("exemple.fr")
  })

  test("un plantage du site garde l'audience déjà lue", async () => {
    const { summary, error } = await executerRefresh({
      periode: "mois",
      chargerAudience: async () => ok,
      invaliderSite: async () => {
        throw new Error("no function")
      },
    })
    expect(summary.status).toBe("ok")
    expect(error).toMatch(/échoué|joignable/)
  })
})

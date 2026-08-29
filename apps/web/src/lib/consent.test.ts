import { describe, expect, test } from "vitest"
import {
  activeCategories,
  allDenied,
  allGranted,
  consentModeDefault,
  consentModeState,
  consentTags,
  cookiesToClear,
  parseConsent,
  shouldAskConsent,
  tagsToInject,
  type ConsentRecord,
} from "./consent"

const NOW = Date.parse("2026-08-29T00:00:00.000Z")
const CONFIG = { consentVersion: "1.0.0", expirationDays: 365 }

const UMAMI = {
  PUBLIC_UMAMI_URL: "https://stats.exemple.fr",
  PUBLIC_UMAMI_WEBSITE_ID: "site-1",
}

function record(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    consentVersion: "1.0.0",
    visitorId: "v-1",
    consentId: "c-1",
    action: "custom",
    timestamp: new Date(NOW).toISOString(),
    ...allDenied(),
    ...overrides,
  }
}

describe("consentTags", () => {
  test("un site sans tiers n'a rien à demander", () => {
    expect(consentTags({})).toEqual([])
    expect(shouldAskConsent({})).toBe(false)
  })

  test("le comptage seul ne demande rien", () => {
    // `script.js` d'Umami ne dépose pas de cookie et n'identifie personne :
    // il est chargé par `Analytics.astro` sans passer par ici. Un bandeau
    // qui proposerait de le refuser décrirait un site qui n'existe pas.
    expect(consentTags(UMAMI)).toEqual([])
    expect(shouldAskConsent(UMAMI)).toBe(false)
  })

  test("l'enregistrement de session, lui, demande", () => {
    const env = { ...UMAMI, PUBLIC_UMAMI_RECORDER: "true" }
    expect(consentTags(env)).toEqual([
      {
        id: "umami-recorder",
        category: "analytics",
        src: "https://stats.exemple.fr/recorder.js",
        attrs: { "data-website-id": "site-1" },
      },
    ])
    expect(activeCategories(env)).toEqual(["analytics"])
  })

  test("un enregistreur sans URL Umami ne produit pas de balise boiteuse", () => {
    expect(consentTags({ PUBLIC_UMAMI_RECORDER: "true" })).toEqual([])
  })

  test("Meta et Google sont du marketing, et rien d'autre ne l'est", () => {
    const env = { PUBLIC_META_PIXEL_ID: "1234567890", PUBLIC_GOOGLE_TAG_ID: "G-ABC123" }
    const tags = consentTags(env)
    expect(tags.map((tag) => tag.id)).toEqual(["meta-pixel", "google-tag", "google-tag-init"])
    expect(tags.every((tag) => tag.category === "marketing")).toBe(true)
    expect(activeCategories(env)).toEqual(["marketing"])
  })

  test("l'identifiant Google est encodé dans l'URL", () => {
    // Il vient d'une variable d'environnement posée par un opérateur. Une
    // valeur inattendue doit produire une URL cassée, jamais une URL vers
    // autre chose.
    const [tag] = consentTags({ PUBLIC_GOOGLE_TAG_ID: "G-A&B" })
    expect(tag!.src).toBe("https://www.googletagmanager.com/gtag/js?id=G-A%26B")
  })

  test("les identifiants passent par JSON.stringify dans le code en ligne", () => {
    const [tag] = consentTags({ PUBLIC_META_PIXEL_ID: `12'); alert(1); //` })
    expect(tag!.code).toContain(`fbq('init',"12'); alert(1); //")`)
  })
})

describe("tagsToInject", () => {
  const env = { ...UMAMI, PUBLIC_UMAMI_RECORDER: "true", PUBLIC_META_PIXEL_ID: "1234567890" }

  test("sans réponse, rien ne part", () => {
    // Le point de tout le fichier : tant que la question est posée, la
    // réponse est non.
    expect(tagsToInject(env, null)).toEqual([])
  })

  test("un refus est un refus", () => {
    expect(tagsToInject(env, allDenied())).toEqual([])
  })

  test("un accord partiel ne charge que ce qui a été accordé", () => {
    const tags = tagsToInject(env, { ...allDenied(), analytics: true })
    expect(tags.map((tag) => tag.id)).toEqual(["umami-recorder"])
  })

  test("tout accepter charge tout", () => {
    const tags = tagsToInject(env, allGranted())
    expect(tags.map((tag) => tag.id)).toEqual(["umami-recorder", "meta-pixel"])
  })
})

describe("cookiesToClear", () => {
  const env = { PUBLIC_META_PIXEL_ID: "1", PUBLIC_GOOGLE_TAG_ID: "G-1" }

  test("retirer un accord nomme les cookies à effacer", () => {
    // Couper le futur en laissant le passé sur l'appareil n'est pas un
    // retrait — c'est ce que fait un bandeau sur deux.
    expect(cookiesToClear(env, allDenied())).toEqual(["_fbp", "_fbc", "_ga", "_gid", "_gcl_au"])
  })

  test("un accord maintenu n'efface rien", () => {
    expect(cookiesToClear(env, allGranted())).toEqual([])
  })
})

describe("parseConsent", () => {
  test("un aller-retour rend la même réponse", () => {
    const stored = record({ analytics: true })
    expect(parseConsent(JSON.stringify(stored), CONFIG, NOW)).toEqual(stored)
  })

  test("rien, ou illisible, vaut « pas de réponse »", () => {
    expect(parseConsent(null, CONFIG, NOW)).toBeNull()
    expect(parseConsent("", CONFIG, NOW)).toBeNull()
    expect(parseConsent("{", CONFIG, NOW)).toBeNull()
    expect(parseConsent("null", CONFIG, NOW)).toBeNull()
    expect(parseConsent('"oui"', CONFIG, NOW)).toBeNull()
  })

  test("une réponse à une autre version de politique est redemandée", () => {
    // Ajouter un tiers change la question. La réponse d'avant ne portait
    // pas dessus.
    const stored = record({ consentVersion: "0.9.0", ...allGranted() })
    expect(parseConsent(JSON.stringify(stored), CONFIG, NOW)).toBeNull()
  })

  test("une réponse périmée est redemandée", () => {
    const stored = JSON.stringify(record(allGranted()))
    const year = 365 * 24 * 60 * 60 * 1000
    expect(parseConsent(stored, CONFIG, NOW + year - 1)).not.toBeNull()
    expect(parseConsent(stored, CONFIG, NOW + year + 1)).toBeNull()
  })

  test("un champ manquant ou d'un autre type ne se lit jamais « oui »", () => {
    // Le défaut en cas de doute est de redemander : un état à moitié lu qui
    // vaudrait accord ferait exactement l'inverse de ce qu'on garantit.
    const { marketing: _omis, ...sansMarketing } = record(allGranted())
    expect(parseConsent(JSON.stringify(sansMarketing), CONFIG, NOW)).toBeNull()
    expect(parseConsent(JSON.stringify(record({ action: "peut-être" as never })), CONFIG, NOW)).toBeNull()
    expect(parseConsent(JSON.stringify(record({ timestamp: "hier" })), CONFIG, NOW)).toBeNull()
    expect(parseConsent(JSON.stringify(record({ visitorId: 42 as never })), CONFIG, NOW)).toBeNull()
  })
})

describe("Google Consent Mode v2", () => {
  test("les sept signaux sont couverts, et security_storage est toujours accordé", () => {
    // Il couvre la lutte contre la fraude et l'authentification. Le refuser
    // n'est pas une option qu'on peut offrir honnêtement.
    const state = consentModeState(allDenied())
    expect(Object.keys(state).sort()).toEqual([
      "ad_personalization",
      "ad_storage",
      "ad_user_data",
      "analytics_storage",
      "functionality_storage",
      "personalization_storage",
      "security_storage",
    ])
    expect(state.security_storage).toBe("granted")
  })

  test("marketing porte les trois signaux publicitaires d'un coup", () => {
    // `ad_user_data` et `ad_personalization` sont l'ajout de la v2 : les
    // omettre, c'est rester en v1 et se faire couper les données de l'EEE.
    const state = consentModeState({ ...allDenied(), marketing: true })
    expect(state.ad_storage).toBe("granted")
    expect(state.ad_user_data).toBe("granted")
    expect(state.ad_personalization).toBe("granted")
    expect(state.analytics_storage).toBe("denied")
  })

  test("le défaut refuse tout et fait patienter la balise", () => {
    const code = consentModeDefault({ googleConsentMode: { enabled: true } })
    expect(code).toContain(`gtag('consent','default'`)
    expect(code).toContain(`"ad_storage":"denied"`)
    expect(code).toContain(`"analytics_storage":"denied"`)
    // Sans ce délai, une balise plus rapide que le clic enregistre un refus
    // qui n'en était pas un.
    expect(code).toContain(`"wait_for_update":500`)
    expect(code).not.toContain("region")
  })

  test("la région n'est ajoutée que si un opérateur la demande", () => {
    const code = consentModeDefault({ googleConsentMode: { enabled: true, region: ["FR", "BE"] } })
    expect(code).toContain(`"region":["FR","BE"]`)
  })

})

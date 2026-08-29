// Ce que le site a le droit de charger, et à quelle condition.
//
// La règle, en une phrase : une balise qui dépose quelque chose sur
// l'appareil du visiteur, ou qui l'identifie, attend son accord ; une balise
// qui ne fait ni l'un ni l'autre n'attend rien.
//
// Le modèle est celui d'Open Consent (https://www.openconsent.dev/docs,
// MIT) — mêmes catégories, même `consentVersion`, même `expirationDays`,
// même Google Consent Mode v2, même enregistrement de traçabilité. Ce qui
// change est l'exécution : Open Consent se livre par le registre shadcn et
// suppose React. `apps/web` ne charge aucun framework, et un bandeau ne
// justifie pas d'en ajouter un — la page publique reste du HTML servi.
// Reprendre le modèle plutôt que le paquet garde ses garanties sans son
// coût.
//
// Ce fichier ne touche ni au DOM ni au stockage — il répond seulement à
// « quelles balises, pour quel consentement ». C'est ce qui permet de
// vérifier « aucun pixel ne part sans accord » par un test, plutôt que par
// une inspection à l'œil dans un onglet réseau.

/**
 * Les familles entre lesquelles un visiteur peut trancher séparément.
 *
 * Les clés sont celles d'Open Consent, en anglais, alors que tout le reste
 * du site est en français : elles voyagent jusqu'à Google Consent Mode, où
 * `analytics` et `marketing` ont un sens fixé par Google. Les traduire
 * n'aurait rendu lisible qu'un fichier, et illisible la correspondance.
 * Les libellés affichés, eux, sont en français — voir `CATEGORY_LABELS`.
 */
export const CONSENT_CATEGORIES = ["analytics", "marketing", "preferences"] as const
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number]

/**
 * La catégorie « nécessaire » n'est pas dans la liste, et c'est délibéré :
 * elle ne se refuse pas, donc elle n'est pas un choix. L'afficher comme une
 * case cochée et grisée est un mensonge poli très répandu — le bandeau la
 * mentionne en toutes lettres, sans faire semblant d'offrir un interrupteur.
 */
export const CATEGORY_LABELS: Record<ConsentCategory, { title: string; description: string }> = {
  analytics: {
    title: "Mesure d'audience",
    description:
      "Comprendre comment les pages sont parcourues. Le comptage de base ne dépose rien et fonctionne sans cette case ; ce qui la demande, c'est l'enregistrement des sessions.",
  },
  marketing: {
    title: "Publicité",
    description:
      "Mesurer les campagnes et retrouver les personnes venues d'une publicité. C'est la seule catégorie qui transmet quelque chose à un tiers à des fins commerciales.",
  },
  preferences: {
    title: "Confort",
    description:
      "Retenir des réglages d'affichage et les outils d'aide en ligne. Le site fonctionne sans.",
  },
}

/** Ce que le visiteur a cliqué. Repris tel quel d'Open Consent. */
export type ConsentAction = "accept_all" | "reject_all" | "custom" | "update"

export const CONSENT_STORAGE_KEY = "astrotan.consent"

export interface ConsentConfig {
  /**
   * La version de la politique. Une chaîne, pas un nombre : c'est la version
   * du *document* que la personne a accepté, et c'est ce qui rend le
   * consentement révisable. Ajouter un tiers change la question posée ; la
   * réponse d'avant ne portait pas dessus, donc on redemande.
   */
  consentVersion: string
  /** Durée de validité d'une réponse, en jours. */
  expirationDays: number
  privacyPolicyUrl: string
  cookiePolicyUrl: string
  position: "bottom" | "top" | "bottom-left" | "bottom-right"
  googleConsentMode: { enabled: boolean; region?: string[] }
  traceability: { enabled: boolean; endpoint: string }
}

export type ConsentChoices = Record<ConsentCategory, boolean>

export interface ConsentRecord extends ConsentChoices {
  consentVersion: string
  /** Identifie l'appareil d'une réponse à l'autre, pour lier une mise à jour à son état antérieur. */
  visitorId: string
  /** Identifie CE geste. Deux clics successifs sont deux enregistrements. */
  consentId: string
  action: ConsentAction
  /** ISO 8601, comme Open Consent — lisible dans un export sans reformatage. */
  timestamp: string
}

export function allDenied(): ConsentChoices {
  return { analytics: false, marketing: false, preferences: false }
}

export function allGranted(): ConsentChoices {
  return { analytics: true, marketing: true, preferences: true }
}

export interface ConsentEnv {
  PUBLIC_UMAMI_URL?: string
  PUBLIC_UMAMI_WEBSITE_ID?: string
  PUBLIC_UMAMI_RECORDER?: string
  /** Meta (Facebook) Pixel — `123456789012345`. */
  PUBLIC_META_PIXEL_ID?: string
  /** Google — `G-XXXXXXXXXX`, `AW-…` ou `GT-…`, selon la propriété. */
  PUBLIC_GOOGLE_TAG_ID?: string
}

/**
 * Une balise que la page peut poser une fois l'accord obtenu.
 *
 * `id` sert à l'idempotence : le bandeau injecte au clic, et une personne
 * peut rouvrir ses réglages et confirmer deux fois. Deux fois le même pixel,
 * c'est deux fois la même conversion comptée.
 *
 * `cookies` est ce qu'Open Consent appelle `onRevoke` : les cookies que ce
 * tiers dépose, pour pouvoir les effacer quand l'accord est retiré. Un
 * interrupteur qui coupe le futur en laissant le passé sur l'appareil n'est
 * pas un retrait.
 */
export interface ConsentTag {
  id: string
  /** Ce qui conditionne son CHARGEMENT. */
  category: ConsentCategory
  src?: string
  attrs?: Record<string, string>
  code?: string
  cookies?: string[]
  /**
   * Les catégories qui doivent apparaître dans le bandeau à cause de cette
   * balise, sans pour autant conditionner son chargement.
   *
   * Le cas qui a rendu ce champ nécessaire : un conteneur Google `GT-` sert
   * à la fois la mesure et la publicité. Le charger sous la seule catégorie
   * « Publicité » faisait disparaître la case « Mesure d'audience » du
   * bandeau — et `readSwitches` part de « tout refusé », si bien que
   * `analytics_storage` restait `denied` pour quiconque passait par
   * « Personnaliser », alors que « Tout accepter » l'accordait. Deux
   * chemins, même intention, deux états Consent Mode différents, et rien
   * pour le signaler.
   */
  alsoAsks?: ConsentCategory[]
}

function trimSlash(url: string): string {
  return url.replace(/\/$/, "")
}

/**
 * Toutes les balises que CE site pourrait charger, d'après sa configuration.
 *
 * Rien n'est écrit en dur ici de ce qui n'est pas configuré : sans
 * `PUBLIC_META_PIXEL_ID`, Meta n'existe pas pour ce site, et la case
 * « Publicité » ne s'affiche pas dans le bandeau. L'absence de configuration
 * est l'interrupteur — le même principe que `analyticsScripts`.
 */
export function consentTags(
  env: ConsentEnv & Record<string, unknown>,
  /**
   * Reflète `consentConfig.googleConsentMode.enabled`. Par défaut `true` :
   * l'immense majorité des appels n'a pas à s'en soucier, et l'oubli du
   * paramètre ne doit pas produire un site qui charge Google sans défaut.
   */
  googleConsentMode = true,
): ConsentTag[] {
  const tags: ConsentTag[] = []

  const umami = env.PUBLIC_UMAMI_URL ? trimSlash(env.PUBLIC_UMAMI_URL) : undefined
  const websiteId = env.PUBLIC_UMAMI_WEBSITE_ID

  // `recorder.js` rejoue ce qu'une personne a fait sur la page — mouvements,
  // clics, saisies. Le comptage note qu'elle est venue ; celui-ci regarde
  // par-dessus son épaule. Le premier se passe d'accord, le second non.
  if (umami && websiteId && env.PUBLIC_UMAMI_RECORDER === "true") {
    tags.push({
      id: "umami-recorder",
      category: "analytics",
      src: `${umami}/recorder.js`,
      attrs: { "data-website-id": websiteId },
    })
  }

  if (env.PUBLIC_META_PIXEL_ID) {
    const pixelId = env.PUBLIC_META_PIXEL_ID
    tags.push({
      id: "meta-pixel",
      category: "marketing",
      code: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(pixelId)});fbq('track','PageView');`,
      cookies: ["_fbp", "_fbc"],
    })
  }

  if (env.PUBLIC_GOOGLE_TAG_ID) {
    const tagId = env.PUBLIC_GOOGLE_TAG_ID
    // Le préfixe de l'identifiant dit à quoi la balise sert, et c'est la
    // seule information disponible pour la classer :
    //
    //   `G-`   GA4        → mesure
    //   `AW-`  Google Ads → publicité
    //   `DC-`  Campaign Manager → publicité
    //   `GT-`  conteneur Google Tag → les deux, donc chargé au plus
    //          exigeant, mais il fait quand même poser la question de la
    //          mesure (`alsoAsks`), sans quoi `analytics_storage` reste
    //          refusé pour un conteneur qui contient GA4.
    //
    // Tout ce qui n'est pas reconnu prend le traitement le plus exigeant :
    // se tromper dans ce sens coûte une case de trop, se tromper dans
    // l'autre charge un traceur publicitaire sans accord.
    const mesureSeule = tagId.startsWith("G-")
    const category: ConsentCategory = mesureSeule ? "analytics" : "marketing"
    const alsoAsks: ConsentCategory[] =
      mesureSeule || tagId.startsWith("AW-") || tagId.startsWith("DC-") ? [] : ["analytics"]

    // Consent Mode éteint alors qu'une balise Google est configurée : on ne
    // charge rien. Sans le bloc de défaut, Google cesse de traiter les
    // données de l'EEE, du Royaume-Uni et de la Suisse — et le site n'a
    // aucun moyen de s'en apercevoir. Une balise silencieusement inutile
    // vaut moins qu'une balise absente.
    if (googleConsentMode) {
      tags.push({
        id: "google-tag",
        category,
        alsoAsks,
        src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tagId)}`,
      })
      tags.push({
        id: "google-tag-init",
        category,
        alsoAsks,
        code: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',${JSON.stringify(tagId)});`,
        // `_ga_<id>` est le cookie de session de GA4, et c'est LUI qui porte
        // la continuité : l'oublier laissait GA4 reprendre la même session
        // au rechargement après un « Tout refuser ». Son nom se dérive de
        // l'identifiant, d'où le calcul plutôt qu'une constante.
        //
        // `_gid` a été retiré : c'est un cookie d'Universal Analytics, que
        // GA4 ne dépose plus. L'annoncer sur `/cookies` décrivait un dépôt
        // qui n'a pas lieu — inoffensif, mais la page promet de ne décrire
        // que ce qui tourne réellement.
        cookies: ["_ga", `_ga_${tagId.replace(/^(G|GT|AW|DC)-/, "")}`, "_gcl_au"],
      })
    }
  }

  return tags
}

/**
 * Les catégories à proposer, et rien qu'elles.
 *
 * Un bandeau qui offre de refuser une chose que le site ne fait pas donne
 * une fausse image de ce qu'il fait. Si aucune catégorie n'est en jeu, il
 * n'y a pas de bandeau — voir `shouldAskConsent`.
 */
export function activeCategories(
  env: ConsentEnv & Record<string, unknown>,
  googleConsentMode = true,
): ConsentCategory[] {
  const used = new Set<ConsentCategory>()
  for (const tag of consentTags(env, googleConsentMode)) {
    used.add(tag.category)
    for (const autre of tag.alsoAsks ?? []) used.add(autre)
  }
  return CONSENT_CATEGORIES.filter((category) => used.has(category))
}

/** Vrai quand ce site a quelque chose à demander. */
export function shouldAskConsent(
  env: ConsentEnv & Record<string, unknown>,
  googleConsentMode = true,
): boolean {
  return activeCategories(env, googleConsentMode).length > 0
}

/**
 * Relit une réponse stockée. Rend `null` dès que quoi que ce soit cloche —
 * illisible, d'une autre version de politique, périmée.
 *
 * Le défaut en cas de doute est de redemander, jamais de supposer un accord :
 * un état corrompu qui se lirait « oui » ferait exactement le contraire de
 * ce que ce fichier existe pour garantir.
 */
export function parseConsent(
  raw: string | null | undefined,
  config: Pick<ConsentConfig, "consentVersion" | "expirationDays">,
  now: number,
): ConsentRecord | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== "object" || parsed === null) return null
  const value = parsed as Record<string, unknown>

  if (value.consentVersion !== config.consentVersion) return null
  if (typeof value.timestamp !== "string") return null

  const at = Date.parse(value.timestamp)
  if (Number.isNaN(at)) return null
  if (now - at > config.expirationDays * 24 * 60 * 60 * 1000) return null

  for (const category of CONSENT_CATEGORIES) {
    if (typeof value[category] !== "boolean") return null
  }
  if (typeof value.visitorId !== "string" || typeof value.consentId !== "string") return null
  if (
    value.action !== "accept_all" &&
    value.action !== "reject_all" &&
    value.action !== "custom" &&
    value.action !== "update"
  ) {
    return null
  }

  return {
    consentVersion: config.consentVersion,
    visitorId: value.visitorId,
    consentId: value.consentId,
    action: value.action,
    timestamp: value.timestamp,
    analytics: value.analytics as boolean,
    marketing: value.marketing as boolean,
    preferences: value.preferences as boolean,
  }
}

/**
 * Les balises à poser pour une réponse donnée.
 *
 * Sans réponse — personne n'a encore répondu — la liste est vide. C'est le
 * point qui compte : tant que la question est posée, la réponse par défaut
 * est non, et aucune requête ne part.
 */
export function tagsToInject(
  env: ConsentEnv & Record<string, unknown>,
  consent: ConsentRecord | ConsentChoices | null,
  googleConsentMode = true,
): ConsentTag[] {
  if (consent === null) return []
  return consentTags(env, googleConsentMode).filter((tag) => consent[tag.category])
}

/** Les cookies à effacer quand une catégorie passe de accordée à refusée. */
export function cookiesToClear(
  env: ConsentEnv & Record<string, unknown>,
  consent: ConsentChoices,
  googleConsentMode = true,
): string[] {
  const names = consentTags(env, googleConsentMode)
    .filter((tag) => !consent[tag.category])
    .flatMap((tag) => tag.cookies ?? [])
  return [...new Set(names)]
}

// ---------------------------------------------------------------------------
// Google Consent Mode v2
// ---------------------------------------------------------------------------

/**
 * Les sept signaux de Consent Mode v2.
 *
 * Obligatoire depuis mars 2024 pour tout site qui envoie du trafic de l'EEE,
 * du Royaume-Uni ou de la Suisse vers Google Analytics ou Google Ads : sans
 * eux, Google cesse purement et simplement de traiter les données de ces
 * régions. Ce n'est pas une amélioration de conformité, c'est la condition
 * pour que la balise serve encore à quelque chose.
 */
export type ConsentModeSignal =
  | "ad_storage"
  | "ad_user_data"
  | "ad_personalization"
  | "analytics_storage"
  | "functionality_storage"
  | "personalization_storage"
  | "security_storage"

export type ConsentModeState = Record<ConsentModeSignal, "granted" | "denied">

/**
 * Traduit nos trois catégories vers les sept signaux de Google.
 *
 * `security_storage` est toujours accordé et n'a pas de case : il couvre la
 * lutte contre la fraude et l'authentification, qui relèvent du strictement
 * nécessaire. Le refuser n'est pas une option qu'on peut honnêtement offrir.
 */
export function consentModeState(choices: ConsentChoices): ConsentModeState {
  const ads = choices.marketing ? "granted" : "denied"
  const prefs = choices.preferences ? "granted" : "denied"
  return {
    ad_storage: ads,
    ad_user_data: ads,
    ad_personalization: ads,
    analytics_storage: choices.analytics ? "granted" : "denied",
    functionality_storage: prefs,
    personalization_storage: prefs,
    security_storage: "granted",
  }
}

/**
 * L'état par défaut, posé AVANT `gtag.js` et avant toute réponse.
 *
 * `wait_for_update` dit à Google de patienter ce nombre de millisecondes
 * avant de conclure : une balise chargée plus vite que le clic du visiteur
 * enregistrerait sinon un refus qui n'en était pas un. 500 ms est la valeur
 * que documente Google.
 *
 * ATTENTION — dans CE site, ce délai ne sert jamais, et croire l'inverse
 * conduit à casser la vraie garantie. `gtag.js` n'est pas dans le HTML : il
 * est injecté après la réponse, et l'appel `gtag('consent','update', …)`
 * part AVANT cette injection, aussi bien au premier passage qu'au retour
 * d'un visiteur connu. Ce qui empêche un faux refus est donc cet ORDRE, pas
 * les 500 ms. Le délai reste comme filet pour le jour où quelqu'un ajoutera
 * une balise Google en dur dans le `<head>`.
 */
export function consentModeDefault(config: Pick<ConsentConfig, "googleConsentMode">): string {
  const denied = consentModeState(allDenied())
  const payload: Record<string, unknown> = { ...denied, wait_for_update: 500 }
  // Sans `region`, le défaut s'applique au monde entier — le choix le plus
  // protecteur, et celui qu'on garde par défaut. Le restreindre à l'EEE est
  // une décision d'opérateur, pas un réglage technique.
  if (config.googleConsentMode.region?.length) {
    payload.region = config.googleConsentMode.region
  }
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('consent','default',${JSON.stringify(payload)});`
}

import { describe, expect, test } from "vitest"
import { enTetesSecurite, nouveauNonce } from "./securityHeaders"

const ENV = { PUBLIC_CONVEX_URL: "https://exemple.convex.cloud" }

describe("enTetesSecurite", () => {
  test("la CSP porte le nonce et refuse tout le reste en script", () => {
    const csp = enTetesSecurite("abc123", ENV)["Content-Security-Policy"]
    expect(csp).toContain("script-src 'self' 'nonce-abc123'")
    expect(csp).toContain("default-src 'self'")
  })

  test("les images distantes sont refusées", () => {
    // C'est le point de toute la tâche : un `<img src>` collé dans un
    // article chargeait un tiers hors du bandeau de consentement.
    const csp = enTetesSecurite("abc123", ENV)["Content-Security-Policy"]
    expect(csp).toContain("img-src 'self' data: blob:")
    expect(csp).not.toContain("img-src *")
  })

  test("le domaine Convex est autorisé en connexion, et lui seul", () => {
    // Le site lit ses pages depuis Convex : sans cette ligne, la CSP casse
    // le site au lieu de le protéger.
    const csp = enTetesSecurite("abc123", ENV)["Content-Security-Policy"]
    expect(csp).toContain("connect-src 'self' https://exemple.convex.cloud")
  })

  test("les polices inlinées au build sont autorisées", () => {
    // Vite transforme les petites polices en `data:font/woff2;base64,…`.
    // `font-src 'self'` seul les refuse — et la panne n'existe qu'en
    // production, invisible depuis le serveur de développement.
    const csp = enTetesSecurite("abc123", ENV)["Content-Security-Policy"]
    expect(csp).toContain("font-src 'self' data:")
  })

  test("les autres en-têtes sont posés", () => {
    const h = enTetesSecurite("abc123", ENV)
    expect(h["X-Content-Type-Options"]).toBe("nosniff")
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin")
    expect(h["X-Frame-Options"]).toBe("DENY")
    expect(h["Permissions-Policy"]).toContain("geolocation=()")
  })

  test("HSTS n'est posé qu'en HTTPS", () => {
    // Posé en développement sur http://localhost, il épingle le navigateur
    // sur une origine qui n'a pas de certificat, et le site devient
    // inaccessible jusqu'à purge manuelle du cache HSTS.
    expect(enTetesSecurite("a", ENV, false)["Strict-Transport-Security"]).toBeUndefined()
    expect(enTetesSecurite("a", ENV, true)["Strict-Transport-Security"]).toContain("max-age=")
  })
})

describe("nouveauNonce", () => {
  test("deux appels ne rendent jamais la même valeur", () => {
    // Un nonce réutilisé n'est pas un nonce : il redevient une liste
    // d'autorisation que n'importe quel script injecté peut recopier.
    expect(nouveauNonce()).not.toBe(nouveauNonce())
  })
})

// ---------------------------------------------------------------------
// Umami — le cas que le brief ne couvrait pas
// ---------------------------------------------------------------------
// `Analytics.astro` pose `<script src="${PUBLIC_UMAMI_URL}/script.js">`, et
// ce script poste ensuite ses vues sur `${PUBLIC_UMAMI_URL}/api/send`. Ni
// l'un ni l'autre n'est `'self'`. Avec la CSP du brief telle quelle, la
// mesure d'audience s'arrête — sans erreur visible ailleurs que dans la
// console d'un navigateur que personne n'ouvre.
describe("la mesure d'audience survit à la CSP", () => {
  const AVEC_UMAMI = {
    PUBLIC_CONVEX_URL: "https://exemple.convex.cloud",
    PUBLIC_UMAMI_URL: "https://umami.exemple.fr",
  }

  test("l'origine Umami est autorisée en connexion", () => {
    // `script.js` envoie chaque vue par `fetch` : sans cette origine dans
    // `connect-src`, le script se charge, s'exécute, et ne compte rien.
    const csp = enTetesSecurite("abc123", AVEC_UMAMI)["Content-Security-Policy"]
    expect(csp).toContain("connect-src 'self' https://exemple.convex.cloud https://umami.exemple.fr")
  })

  test("l'origine Umami est autorisée en script", () => {
    // Redondant avec `'strict-dynamic'` sur un navigateur qui l'implémente,
    // indispensable sur celui qui ne l'implémente pas : là, `'strict-dynamic'`
    // est ignoré et seule la liste d'origines répond.
    const csp = enTetesSecurite("abc123", AVEC_UMAMI)["Content-Security-Policy"]
    expect(csp).toContain("https://umami.exemple.fr")
    expect(csp!.split("; ").find((d) => d.startsWith("script-src"))).toContain(
      "https://umami.exemple.fr",
    )
  })

  test("le slash final d'une URL Umami ne produit pas une origine invalide", () => {
    // `PUBLIC_UMAMI_URL=https://umami.exemple.fr/` est la faute de frappe
    // qu'on fait une fois. `https://umami.exemple.fr/` dans une CSP est une
    // source de *chemin*, pas la même chose qu'une origine.
    const csp = enTetesSecurite("a", {
      ...AVEC_UMAMI,
      PUBLIC_UMAMI_URL: "https://umami.exemple.fr/",
    })["Content-Security-Policy"]
    expect(csp).not.toContain("https://umami.exemple.fr/ ")
    expect(csp).toContain("connect-src 'self' https://exemple.convex.cloud https://umami.exemple.fr")
  })

  test("sans Umami configuré, rien n'est ajouté", () => {
    // L'absence de configuration est l'interrupteur, ici comme dans
    // `analyticsScripts` : une CSP qui autoriserait une origine vide
    // autoriserait n'importe quoi.
    const csp = enTetesSecurite("a", ENV)["Content-Security-Policy"]
    expect(csp).toContain("connect-src 'self' https://exemple.convex.cloud;")
  })
})

// ---------------------------------------------------------------------
// La médiathèque — le second cas où « pas d'image distante » allait trop loin
// ---------------------------------------------------------------------
// Deux médias n'empruntent pas le proxy `/_image` d'`astro:assets` et
// arrivent au navigateur sur l'origine du déploiement Convex : le favicon
// téléversé depuis les réglages, et une image collée dans le corps d'un
// article. `img-src 'self' data: blob:` les refusait tous les deux.
describe("les médias servis par Convex", () => {
  test("l'origine Convex est autorisée en image", () => {
    const csp = enTetesSecurite("abc123", ENV)["Content-Security-Policy"]
    expect(csp).toContain("img-src 'self' data: blob: https://exemple.convex.cloud")
  })

  test("une origine tierce reste refusée en image", () => {
    // Toute la tâche tient dans cette assertion : ouvrir NOTRE stockage
    // n'ouvre pas le traqueur collé dans un article.
    const csp = enTetesSecurite("abc123", ENV)["Content-Security-Policy"]!
    const img = csp.split("; ").find((d) => d.startsWith("img-src"))
    expect(img).toBe("img-src 'self' data: blob: https://exemple.convex.cloud")
    expect(img).not.toContain("https://traqueur.exemple")
  })

  test("le slash final d'une URL Convex ne produit pas une origine invalide", () => {
    // Même normalisation que pour Umami : la relecture a relevé qu'un seul
    // des deux la recevait, et que le test du slash final était donc vrai
    // pour une variable et faux pour l'autre.
    const csp = enTetesSecurite("a", {
      PUBLIC_CONVEX_URL: "https://exemple.convex.cloud/",
    })["Content-Security-Policy"]!
    expect(csp).not.toContain("https://exemple.convex.cloud/ ")
    expect(csp).toContain("connect-src 'self' https://exemple.convex.cloud;")
    expect(csp).toContain("img-src 'self' data: blob: https://exemple.convex.cloud;")
  })

  test("sans Convex configuré, aucune origine vide n'est écrite", () => {
    // `connect-src 'self' ` suivi de rien autoriserait la directive à se
    // lire de travers ; `img-src` doit retomber sur la politique stricte.
    const csp = enTetesSecurite("a", {})["Content-Security-Policy"]!
    expect(csp).toContain("connect-src 'self';")
    expect(csp).toContain("img-src 'self' data: blob:;")
  })
})

// ---------------------------------------------------------------------
// Les pixels Meta et Google — charger n'est pas émettre
// ---------------------------------------------------------------------
// `'strict-dynamic'` ne porte que sur `script-src` : un script noncé peut
// injecter `fbevents.js` et `gtag/js`, qui se chargent donc bel et bien
// après consentement. Ensuite tout était bloqué — `connect-src` ne listait
// que Convex et Umami, `img-src` pas facebook.com, et `frame-src` absent
// retombait sur `default-src 'self'`. Le site demandait l'autorisation d'un
// traitement que son propre serveur rendait impossible, sans que rien ne
// l'affiche.
//
// Deux barrières, et elles restent distinctes : la CSP n'AUTORISE ces
// origines que si l'opérateur a posé la variable de build, et le bandeau ne
// CHARGE la balise que si le visiteur a dit oui.
describe("la CSP et les traceurs soumis à consentement", () => {
  const META = { ...ENV, PUBLIC_META_PIXEL_ID: "123456789012345" }
  const GOOGLE = { ...ENV, PUBLIC_GOOGLE_TAG_ID: "G-XXXXXXXXXX" }

  const directive = (env: Record<string, string>, nom: string) =>
    enTetesSecurite("abc123", env)["Content-Security-Policy"]!
      .split("; ")
      .find((d) => d.startsWith(`${nom} `) || d === nom)

  test("sans identifiant de traceur, la CSP ne nomme ni Google ni Meta", () => {
    // La condition pour que tout le reste soit acceptable : un site sans
    // pixel garde exactement la politique d'avant.
    const csp = enTetesSecurite("abc123", ENV)["Content-Security-Policy"]!
    expect(csp).not.toContain("google")
    expect(csp).not.toContain("facebook")
    expect(csp).not.toContain("doubleclick")
    // `frame-src` n'est pas déclaré : les iframes retombent sur
    // `default-src 'self'`, ce qui est la politique stricte voulue.
    expect(directive(ENV, "frame-src")).toBeUndefined()
  })

  test("avec le pixel Meta, ses trois surfaces sont ouvertes", () => {
    expect(directive(META, "connect-src")).toContain("https://www.facebook.com")
    expect(directive(META, "connect-src")).toContain("https://connect.facebook.net")
    // Le pixel émet un `<img src="https://www.facebook.com/tr?…">` : sans
    // cette origine, la conversion n'est jamais comptée.
    expect(directive(META, "img-src")).toContain("https://www.facebook.com")
    expect(directive(META, "frame-src")).toContain("https://www.facebook.com")
  })

  test("le pixel Meta n'ouvre rien du côté de Google", () => {
    const csp = enTetesSecurite("abc123", META)["Content-Security-Policy"]!
    expect(csp).not.toContain("google")
    expect(csp).not.toContain("doubleclick")
  })

  test("avec la balise Google, ses trois surfaces sont ouvertes", () => {
    // GA4 poste sur `https://www.google-analytics.com/g/collect`, et sur
    // `region1.google-analytics.com` pour le trafic européen — d'où le
    // joker, qui couvre les deux.
    expect(directive(GOOGLE, "connect-src")).toContain("https://*.google-analytics.com")
    expect(directive(GOOGLE, "connect-src")).toContain("https://*.analytics.google.com")
    expect(directive(GOOGLE, "img-src")).toContain("https://*.google-analytics.com")
    expect(directive(GOOGLE, "frame-src")).toContain("https://*.doubleclick.net")
  })

  test("la balise Google n'ouvre rien du côté de Meta", () => {
    expect(enTetesSecurite("abc123", GOOGLE)["Content-Security-Policy"]).not.toContain("facebook")
  })

  test("les deux traceurs cohabitent sans effacer Convex ni Umami", () => {
    // La régression que ce test attrape : une directive reconstruite pour
    // les pixels et qui perdrait en route les origines du site lui-même.
    const csp = enTetesSecurite("abc123", {
      ...ENV,
      PUBLIC_UMAMI_URL: "https://stats.exemple.fr",
      PUBLIC_META_PIXEL_ID: "123456789012345",
      PUBLIC_GOOGLE_TAG_ID: "G-XXXXXXXXXX",
    })["Content-Security-Policy"]!
    const connect = csp.split("; ").find((d) => d.startsWith("connect-src"))!
    expect(connect).toContain("'self'")
    expect(connect).toContain("https://exemple.convex.cloud")
    expect(connect).toContain("https://stats.exemple.fr")
    expect(connect).toContain("https://www.facebook.com")
    expect(connect).toContain("https://*.google-analytics.com")
  })

  test("un identifiant vide n'ouvre rien — c'est l'absence qui fait l'interrupteur", () => {
    // Un build-arg non posé vaut la chaîne vide, jamais `undefined` : si
    // cette chaîne ouvrait la CSP, un adoptant sans traceur hériterait
    // quand même des origines de Google et de Meta.
    const csp = enTetesSecurite("abc123", {
      ...ENV,
      PUBLIC_META_PIXEL_ID: "",
      PUBLIC_GOOGLE_TAG_ID: "",
    })["Content-Security-Policy"]!
    expect(csp).not.toContain("google")
    expect(csp).not.toContain("facebook")
  })
})

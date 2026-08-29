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

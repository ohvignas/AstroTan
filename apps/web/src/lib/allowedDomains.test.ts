import { createRequestFromNodeRequest } from "astro/app/node"
import { describe, expect, test } from "vitest"
import { domainesAutorises } from "./allowedDomains"

// ---------------------------------------------------------------------
// Ce que ce fichier prouve, et pourquoi il ne suffisait pas de le lire.
//
// Derrière Traefik, le conteneur `web` ne voit qu'une seule adresse
// source : celle du conteneur Traefik. `clientAddress` vaut alors la même
// chose pour tout Internet, et les deux limiteurs de débit qui s'en
// servent (`/api/contact`, `/api/consent`) partagent UN seau pour tous les
// visiteurs — cinq messages par heure pour la planète entière.
//
// Astro n'honore `x-forwarded-for` que si l'hôte de la requête a été
// VALIDÉ, et il ne valide rien tant que `security.allowedDomains` est vide
// (son défaut). C'est ce couplage qu'on vérifie ici, sur l'implémentation
// réelle d'Astro plutôt que sur notre lecture de celle-ci : un test qui
// n'exercerait que notre fonction dirait seulement qu'elle rend l'objet
// qu'on attend, pas qu'Astro en fait ce qu'on croit.
// ---------------------------------------------------------------------

/** Le symbole où Astro range l'adresse retenue (`Symbol.for`, donc global). */
const ADRESSE = Symbol.for("astro.clientAddress")

/**
 * Une requête telle que Traefik la présente au conteneur : HTTP en clair,
 * `Host` d'origine préservé, `x-forwarded-*` posés, et une adresse de socket
 * qui est celle du proxy — jamais celle du visiteur.
 */
function requeteDerriereProxy(hote: string) {
  return {
    method: "GET",
    url: "/contact",
    headers: {
      host: hote,
      "x-forwarded-host": hote,
      "x-forwarded-proto": "https",
      "x-forwarded-for": "203.0.113.7",
    },
    socket: { remoteAddress: "172.18.0.4" },
    on() {},
    once() {},
    off() {},
    removeListener() {},
  }
}

function adresseVue(allowedDomains: { hostname: string }[]): string | undefined {
  const requete = createRequestFromNodeRequest(
    requeteDerriereProxy("exemple.fr") as never,
    { skipBody: true, allowedDomains },
  )
  return Reflect.get(requete, ADRESSE) as string | undefined
}

describe("domainesAutorises", () => {
  test("sans domaine configuré, aucun motif n'est produit", () => {
    expect(domainesAutorises(undefined)).toEqual([])
    expect(domainesAutorises("")).toEqual([])
    expect(domainesAutorises("   ")).toEqual([])
  })

  test("un domaine devient un motif d'hôte, en minuscules et sans espaces", () => {
    expect(domainesAutorises("  Exemple.FR ")).toEqual([{ hostname: "exemple.fr" }])
  })

  test("le motif ne fixe AUCUN protocole, et c'est ce qui le fait marcher", () => {
    // Astro valide deux en-têtes contre ces motifs, et pas sous le même
    // protocole : `Host` est confronté au protocole RÉEL de la socket —
    // `http`, puisque Traefik termine le TLS — tandis que `X-Forwarded-Host`
    // l'est sous `https` par défaut. Un motif qui porterait
    // `protocol: "https"` refuserait donc le premier, et un `protocol:
    // "http"` refuserait le second. Sans protocole, les deux passent.
    for (const motif of domainesAutorises("exemple.fr")) {
      expect(Object.keys(motif)).toEqual(["hostname"])
    }
  })

  test("une valeur qui n'est pas un hôte nu est refusée bruyamment", () => {
    // Une URL, un chemin ou un port produisent un motif qui ne correspond
    // à RIEN — donc exactement la panne silencieuse que cette configuration
    // existe pour fermer. Mieux vaut arrêter le build.
    expect(() => domainesAutorises("https://exemple.fr")).toThrow(/WEB_DOMAIN/)
    expect(() => domainesAutorises("exemple.fr/blog")).toThrow(/WEB_DOMAIN/)
    expect(() => domainesAutorises("exemple.fr:4321")).toThrow(/WEB_DOMAIN/)
  })
})

describe("l'adresse du visiteur, derrière le proxy", () => {
  test("sans domaine autorisé, Astro rend l'adresse du PROXY", () => {
    // Le défaut, tel qu'il est aujourd'hui en production : un seul seau de
    // limitation de débit pour tous les visiteurs.
    expect(adresseVue([])).toBe("172.18.0.4")
  })

  test("avec le domaine du site, Astro rend l'adresse du VISITEUR", () => {
    expect(adresseVue(domainesAutorises("exemple.fr"))).toBe("203.0.113.7")
  })

  test("un domaine qui n'est pas le nôtre ne fait pas confiance à l'en-tête", () => {
    // La raison de passer par le mécanisme d'Astro plutôt que de lire
    // `x-forwarded-for` à la main : l'en-tête n'est honoré qu'après
    // validation de l'hôte. Lu directement, il ferait d'une limite de débit
    // un outil d'usurpation — n'importe qui pourrait se donner l'adresse
    // de n'importe qui.
    expect(adresseVue(domainesAutorises("autre.fr"))).toBe("172.18.0.4")
  })
})

import { createRequestFromNodeRequest } from "astro/app/node"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  TTL_ECHEC_MS,
  TTL_SUCCES_MS,
  adresseDuVisiteur,
  hoteNormalise,
  purgerHotesConnus,
} from "./allowedDomains"

// ---------------------------------------------------------------------
// Ce que ce fichier prouve, et pourquoi il ne suffisait pas de le lire.
//
// Derrière Traefik, le conteneur `web` ne voit qu'une seule adresse
// source : celle du conteneur Traefik. Si on s'en contente, les deux
// limiteurs de débit qui s'en servent (`/api/contact`, `/api/consent`)
// partagent UN seau pour tous les visiteurs — cinq messages par heure pour
// la planète entière, et le journal de consentement qui cesse d'écrire.
//
// `x-forwarded-for` porte la vraie adresse, mais c'est un en-tête que
// N'IMPORTE QUI peut poser. Le lire sans condition ferait d'une limite de
// débit un outil d'usurpation. La condition — la seule — est d'avoir
// RECONNU l'hôte de la requête comme l'un des nôtres.
//
// Jusqu'ici cette reconnaissance venait d'Astro (`security.allowedDomains`)
// et la liste était figée AU BUILD, donc changer de domaine imposait de
// reconstruire l'image. Elle vient maintenant du runtime, et c'est ce
// basculement que ces tests tiennent : mêmes réponses qu'avant, sur une
// liste qui peut changer sans redéployer.
// ---------------------------------------------------------------------

/** L'adresse que Traefik présente au conteneur — la même pour tout Internet. */
const SOCKET = "172.18.0.4"
/** L'adresse du visiteur, telle que Traefik la transmet. */
const VISITEUR = "203.0.113.7"

/**
 * Une requête telle que Traefik la présente : HTTP en clair, `Host`
 * d'origine préservé, `x-forwarded-*` posés.
 */
function requeteDerriereProxy(entetes: Record<string, string>) {
  return {
    request: new Request("http://interne:4321/contact", { headers: entetes }),
    clientAddress: SOCKET,
  }
}

function derriere(hote: string) {
  return requeteDerriereProxy({
    host: hote,
    "x-forwarded-host": hote,
    "x-forwarded-proto": "https",
    "x-forwarded-for": VISITEUR,
  })
}

/** Un lecteur d'hôtes qui répond, et qui compte ses appels. */
function lecteur(...hotes: string[]) {
  const lire = vi.fn(async () => hotes)
  return lire
}

/** Un lecteur qui échoue, comme un Convex injoignable. */
function lecteurEnPanne() {
  return vi.fn(async () => {
    throw new Error("fetch failed")
  })
}

beforeEach(() => {
  purgerHotesConnus()
  vi.useFakeTimers()
  // Le repli sur la socket s'annonce dans les journaux ; on ne veut pas
  // qu'il bruite la sortie de la suite.
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("adresseDuVisiteur", () => {
  test("un hôte CONNU fait honorer `x-forwarded-for`", async () => {
    expect(await adresseDuVisiteur(derriere("exemple.fr"), lecteur("exemple.fr"))).toBe(VISITEUR)
  })

  test("un hôte INCONNU ne le fait pas, et l'empreinte retombe sur la socket", async () => {
    // C'est ici que se joue la différence entre une limite de débit et un
    // outil d'usurpation : sans reconnaissance de l'hôte, l'en-tête ne vaut
    // rien, et quiconque pourrait s'attribuer l'adresse de quelqu'un
    // d'autre — ou s'en fabriquer une neuve à chaque requête.
    expect(await adresseDuVisiteur(derriere("pirate.fr"), lecteur("exemple.fr"))).toBe(SOCKET)
  })

  test("Convex injoignable ne fait pas confiance à l'en-tête", async () => {
    // Échec FERMÉ. Un conteneur qui vient de démarrer et qui n'arrive pas à
    // apprendre ses propres hôtes doit se comporter comme s'il n'en
    // connaissait aucun — jamais faire confiance faute de mieux.
    expect(await adresseDuVisiteur(derriere("exemple.fr"), lecteurEnPanne())).toBe(SOCKET)
  })

  test("une panne APRÈS une lecture réussie garde les hôtes déjà connus", async () => {
    // L'autre moitié de l'échec fermé, et elle compte autant : purger la
    // liste à la première secousse réseau ferait retomber TOUS les
    // visiteurs dans un seul seau — précisément la panne qu'on ferme.
    // Un hôte appris reste un hôte à nous ; il ne devient pas douteux
    // parce que Convex a hoqueté.
    const lire = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["exemple.fr"])
      .mockRejectedValue(new Error("fetch failed"))

    expect(await adresseDuVisiteur(derriere("exemple.fr"), lire)).toBe(VISITEUR)
    vi.advanceTimersByTime(TTL_SUCCES_MS + 1)
    expect(await adresseDuVisiteur(derriere("exemple.fr"), lire)).toBe(VISITEUR)
    expect(lire).toHaveBeenCalledTimes(2)
  })

  test("l'hôte est comparé sans son port", async () => {
    expect(await adresseDuVisiteur(derriere("Exemple.FR:443"), lecteur("exemple.fr"))).toBe(VISITEUR)
  })

  test("`x-forwarded-host` seul suffit à reconnaître l'hôte", async () => {
    // Traefik pose les deux ; on accepte l'un OU l'autre, comme le faisait
    // Astro. Les deux viennent du même proxy, aucun n'est plus sûr que
    // l'autre — ce qui protège, c'est que le conteneur n'est joignable que
    // par lui.
    const contexte = requeteDerriereProxy({
      host: "interne:4321",
      "x-forwarded-host": "exemple.fr",
      "x-forwarded-for": VISITEUR,
    })
    expect(await adresseDuVisiteur(contexte, lecteur("exemple.fr"))).toBe(VISITEUR)
  })

  test("une chaîne de proxys : c'est le PREMIER maillon qui est le visiteur", async () => {
    const contexte = requeteDerriereProxy({
      host: "exemple.fr",
      "x-forwarded-for": `${VISITEUR}, 10.0.0.1, 10.0.0.2`,
    })
    expect(await adresseDuVisiteur(contexte, lecteur("exemple.fr"))).toBe(VISITEUR)
  })
})

describe("le coût de la reconnaissance", () => {
  test("sans `x-forwarded-for`, Convex n'est PAS interrogé", async () => {
    // Le développement local n'a pas de proxy : `clientAddress` y est déjà
    // l'adresse réelle, et il n'y a rien à valider. Interroger Convex
    // quand même ferait payer un aller-retour à chaque page d'un site qui
    // n'en a aucun besoin.
    const lire = lecteur("exemple.fr")
    const contexte = requeteDerriereProxy({ host: "localhost:4321" })
    expect(await adresseDuVisiteur(contexte, lire)).toBe(SOCKET)
    expect(lire).not.toHaveBeenCalled()
  })

  test("la liste est mise en cache : une seule lecture pour cent requêtes", async () => {
    const lire = lecteur("exemple.fr")
    for (let i = 0; i < 100; i++) {
      expect(await adresseDuVisiteur(derriere("exemple.fr"), lire)).toBe(VISITEUR)
    }
    expect(lire).toHaveBeenCalledTimes(1)
  })

  test("cent requêtes SIMULTANÉES sur un cache froid ne font qu'une lecture", async () => {
    // Sans cette mise en commun, un redémarrage sous trafic enverrait
    // autant de requêtes à Convex qu'il y a de visiteurs simultanés.
    const lire = lecteur("exemple.fr")
    const toutes = Array.from({ length: 100 }, () =>
      adresseDuVisiteur(derriere("exemple.fr"), lire),
    )
    expect(await Promise.all(toutes)).toEqual(Array(100).fill(VISITEUR))
    expect(lire).toHaveBeenCalledTimes(1)
  })

  test("le cache expire, pour qu'un changement de domaine prenne effet", async () => {
    const lire = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["ancien.fr"])
      .mockResolvedValue(["nouveau.fr"])

    expect(await adresseDuVisiteur(derriere("nouveau.fr"), lire)).toBe(SOCKET)
    vi.advanceTimersByTime(TTL_SUCCES_MS + 1)
    expect(await adresseDuVisiteur(derriere("nouveau.fr"), lire)).toBe(VISITEUR)
  })

  test("un échec est retenu bien plus brièvement qu'un succès", async () => {
    // Un déploiement qui vient de démarrer pendant que Convex redémarre ne
    // doit pas rester une minute sans reconnaître son propre domaine ; et
    // il ne doit pas non plus marteler un service en panne à chaque
    // requête.
    expect(TTL_ECHEC_MS).toBeLessThan(TTL_SUCCES_MS)

    const lire = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValue(["exemple.fr"])

    expect(await adresseDuVisiteur(derriere("exemple.fr"), lire)).toBe(SOCKET)
    vi.advanceTimersByTime(TTL_ECHEC_MS + 1)
    expect(await adresseDuVisiteur(derriere("exemple.fr"), lire)).toBe(VISITEUR)
  })
})

describe("hoteNormalise", () => {
  test("rend un hôte nu, en minuscules, sans port ni point final", () => {
    expect(hoteNormalise("  Exemple.FR.:443 ")).toBe("exemple.fr")
  })

  test("rend `null` pour ce qui n'est pas un hôte nu", () => {
    for (const brut of ["", "   ", "exemple", "exemple.fr/blog", "http://exemple.fr", "*.exemple.fr"]) {
      expect(hoteNormalise(brut)).toBeNull()
    }
  })
})

describe("l'hypothèse sur laquelle tout repose", () => {
  test("sans `allowedDomains`, Astro rend l'adresse de la SOCKET", () => {
    // Ce test n'exerce pas notre code : il épingle le comportement d'Astro
    // dont dépend notre repli. `clientAddress` DOIT valoir la socket, sinon
    // « retomber sur `clientAddress` » retomberait en fait sur
    // `x-forwarded-for` — c'est-à-dire sur l'en-tête qu'on refuse d'honorer,
    // et l'échec fermé de ce module deviendrait un échec ouvert sans qu'une
    // seule ligne d'ici ne change.
    const requete = createRequestFromNodeRequest(
      {
        method: "GET",
        url: "/contact",
        headers: {
          host: "exemple.fr",
          "x-forwarded-host": "exemple.fr",
          "x-forwarded-for": VISITEUR,
        },
        socket: { remoteAddress: SOCKET },
        on() {},
        once() {},
        off() {},
        removeListener() {},
      } as never,
      { skipBody: true, allowedDomains: [] },
    )
    expect(Reflect.get(requete, Symbol.for("astro.clientAddress"))).toBe(SOCKET)
  })
})

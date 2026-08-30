import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { MAX_SORTANTS } from "@astrotan/backend/convex/lib/hotesSortants"
import { composerRoutes } from "./ecrireRoutes"
import { hotesDuFichier, memoireNeuve, passe, type Hotes, type Memoire, type Ports } from "./passe"

const ANCIEN: Hotes = { web: "vieux.fr", admin: "admin.vieux.fr", umami: null }
const NOUVEAU: Hotes = { web: "neuf.fr", admin: "admin.neuf.fr", umami: null }
/** Ce que l'environnement du conteneur porte — le `.env` du VPS. */
const SECOURS: Hotes = { web: "secours.fr", admin: "admin.secours.fr", umami: null }

/**
 * Un jeu de ports entièrement en mémoire.
 *
 * `lireRoutes` et `ecrireRoutes` partagent la même variable : ce que la
 * passe écrit, la passe suivante le relit. C'est la seule façon d'éprouver
 * la propriété qui compte — l'état « hôtes précédents » se relit DU
 * FICHIER, pas d'une mémoire de processus.
 */
function bancDEssai(depart: string | null = null) {
  const banc = {
    fichier: depart,
    ecritures: 0,
    hotes: NOUVEAU as Hotes,
    lectureEchoue: false,
    certificatValide: false,
    // L'environnement du conteneur, tel que le compose le pose. `null`
    // pour l'éprouver absent.
    secours: SECOURS as Hotes | null,
    erreurs: [] as string[],
  }
  const ports: Ports = {
    lireHotes: async () => {
      if (banc.lectureEchoue) throw new Error("fetch failed")
      return banc.hotes
    },
    hotesDeSecours: () => banc.secours,
    lireRoutes: async () => banc.fichier,
    ecrireRoutes: async (contenu) => {
      banc.fichier = contenu
      banc.ecritures += 1
    },
    sertUnCertificatValide: async () => banc.certificatValide,
    journal: {
      info: () => {},
      erreur: (message) => banc.erreurs.push(message),
    },
  }
  return { banc, ports }
}

/** Deux passes concordantes : le minimum pour que quoi que ce soit s'écrive. */
async function deuxPasses(ports: Ports, memoire: Memoire) {
  await passe(ports, memoire)
  return passe(ports, memoire)
}

describe("un échec de lecture ne réécrit rien", () => {
  test("Convex injoignable laisse le fichier exactement tel quel", async () => {
    // La règle générale du plan : échouer FERMÉ. Une coupure réseau qui
    // viderait le routage mettrait le site hors ligne — le contraire de ce
    // que cette fonctionnalité existe pour permettre.
    const routesEnPlace = composerRoutes(ANCIEN, [])
    const { banc, ports } = bancDEssai(routesEnPlace)
    const memoire = memoireNeuve()
    banc.hotes = ANCIEN
    await deuxPasses(ports, memoire)

    banc.lectureEchoue = true
    banc.hotes = NOUVEAU
    const issue = await passe(ports, memoire)

    expect(issue).toBe("lecture-en-échec")
    expect(banc.fichier).toBe(routesEnPlace)
    expect(banc.erreurs).toHaveLength(1)
  })

  test("une lecture en échec annule la confirmation acquise avant elle", async () => {
    // « Deux lectures SUCCESSIVES concordantes » : une panne au milieu
    // rompt la succession. Sans cette remise à zéro, un changement pourrait
    // s'écrire sur la foi d'une lecture prise avant l'incident réseau —
    // c'est-à-dire sur un état dont plus rien ne dit qu'il est encore vrai.
    const { banc, ports } = bancDEssai(composerRoutes(ANCIEN, []))
    const memoire = memoireNeuve()
    banc.hotes = NOUVEAU
    await passe(ports, memoire)

    banc.lectureEchoue = true
    await passe(ports, memoire)

    banc.lectureEchoue = false
    expect(await passe(ports, memoire)).toBe("confirmation-attendue")
    expect(banc.ecritures).toBe(0)
  })
})

describe("il existe toujours un routage", () => {
  // « Ne pas écrire » a deux sens, et le premier jet n'en raisonnait qu'un.
  // Fichier présent, ne rien écrire FIGE le routage — l'échec fermé, celui
  // qui est documenté. Fichier absent — c'est-à-dire au premier démarrage
  // de la version qui a retiré les labels `traefik.http.routers.*.rule` —
  // ne rien écrire laisse Traefik SANS AUCUN ROUTEUR : 404 partout, sans
  // issue par l'interface. Les deux tests qui suivent sont la paire qui
  // sépare ces deux sens ; retirer le repli de `passe.ts` doit faire
  // rougir le premier, et laisser le second vert.

  test("query en échec ET aucun fichier : un routage existe quand même", async () => {
    const { banc, ports } = bancDEssai(null)
    banc.lectureEchoue = true

    const issue = await passe(ports, memoireNeuve())

    expect(issue).toBe("routage-de-secours")
    expect(banc.ecritures).toBe(1)
    // Ce qui compte n'est pas la valeur : c'est qu'il y ait UN routeur.
    expect(banc.fichier).toContain("Host(`secours.fr`)")
    expect(banc.fichier).toContain("Host(`admin.secours.fr`)")
  })

  test("query en échec ET fichier existant : le fichier n'est pas touché", async () => {
    // Le pendant, et il est aussi important : remplacer un routage en
    // place par le repli ramènerait le domaine d'origine du `.env` et
    // déferait un changement de domaine réussi, sur une simple panne
    // réseau.
    const enPlace = composerRoutes(NOUVEAU, [])
    const { banc, ports } = bancDEssai(enPlace)
    banc.lectureEchoue = true

    expect(await passe(ports, memoireNeuve())).toBe("lecture-en-échec")
    expect(banc.ecritures).toBe(0)
    expect(banc.fichier).toBe(enPlace)
    expect(banc.fichier).not.toContain("secours.fr")
  })

  test("un fichier vidé ou tronqué compte comme aucun routage", async () => {
    // Du point de vue de Traefik, un fichier sans `Host()` et un fichier
    // absent sont le même 404. La condition est donc « aucun hôte routé »,
    // pas « aucun fichier ».
    const { banc, ports } = bancDEssai("http:\n  routers:\n")
    banc.lectureEchoue = true

    expect(await passe(ports, memoireNeuve())).toBe("routage-de-secours")
    expect(banc.fichier).toContain("Host(`secours.fr`)")
  })

  test("le repli s'écrit UNE fois, quoi qu'il arrive ensuite", async () => {
    // Le quota Let's Encrypt, encore : cinq certificats par domaine et par
    // semaine, échecs compris. La borne n'est pas un compteur, elle est
    // structurelle — après cette écriture le fichier porte des hôtes, donc
    // la branche ne se reprend plus.
    const { banc, ports } = bancDEssai(null)
    const memoire = memoireNeuve()
    banc.lectureEchoue = true

    await passe(ports, memoire)
    await passe(ports, memoire)
    await passe(ports, memoire)

    expect(banc.ecritures).toBe(1)
  })

  test("sans hôte dans l'environnement, rien n'est écrit — et le remède est nommé", async () => {
    // Le seul cas réellement sans issue. Le `${WEB_DOMAIN:?}` du compose
    // fait que le conteneur ne démarre pas dans cet état ; si on y arrive
    // quand même, le journal doit dire quoi taper, parce qu'il est le seul
    // témoin.
    const { banc, ports } = bancDEssai(null)
    banc.lectureEchoue = true
    banc.secours = null

    expect(await passe(ports, memoireNeuve())).toBe("lecture-en-échec")
    expect(banc.ecritures).toBe(0)
    expect(banc.erreurs.join("\n")).toContain("WEB_DOMAIN")
  })

  test("un repli refusé par `composerRoutes` ne tue pas la boucle", async () => {
    // Le `.env` du VPS n'est pas plus digne de confiance que le reste :
    // une valeur douteuse doit être refusée, journalisée, et laisser le
    // service tourner — la passe suivante réessaiera.
    const { banc, ports } = bancDEssai(null)
    banc.lectureEchoue = true
    banc.secours = { web: "pas-un-hôte", admin: "admin.pas-un-hôte", umami: null }

    expect(await passe(ports, memoireNeuve())).toBe("refus")
    expect(banc.ecritures).toBe(0)
  })

  test("le repli cède la place dès que la query répond, sans laisser tomber son hôte", async () => {
    // Ce qui se passe une fois `ROUTING_SECRET` posé sur Convex : les
    // hôtes réels s'écrivent, et l'hôte de secours reste routé jusqu'à ce
    // que le nouveau serve un certificat valide — la règle générale du
    // service, appliquée telle quelle au repli.
    const { banc, ports } = bancDEssai(null)
    banc.lectureEchoue = true
    await passe(ports, memoireNeuve())
    expect(banc.fichier).toContain("Host(`secours.fr`)")

    banc.lectureEchoue = false
    banc.hotes = NOUVEAU
    banc.certificatValide = false
    await deuxPasses(ports, memoireNeuve())

    expect(banc.fichier).toContain("Host(`neuf.fr`)")
    expect(banc.fichier).toContain("Host(`secours.fr`)")

    banc.certificatValide = true
    await deuxPasses(ports, memoireNeuve())
    expect(banc.fichier).toContain("Host(`neuf.fr`)")
    expect(banc.fichier).not.toContain("secours.fr")
  })
})

describe("anti-battement — deux lectures concordantes avant d'écrire", () => {
  test("une seule lecture n'écrit jamais", async () => {
    // Le quota Let's Encrypt est de CINQ certificats par domaine et par
    // semaine, échecs compris. Un service qui réécrirait à chaque battement
    // le brûlerait en minutes, et l'adoptant passerait une semaine en
    // avertissement de sécurité.
    const { banc, ports } = bancDEssai()
    expect(await passe(ports, memoireNeuve())).toBe("confirmation-attendue")
    expect(banc.ecritures).toBe(0)
    expect(banc.fichier).toBeNull()
  })

  test("deux lectures DIVERGENTES n'écrivent pas davantage", async () => {
    const { banc, ports } = bancDEssai()
    const memoire = memoireNeuve()
    banc.hotes = ANCIEN
    await passe(ports, memoire)
    banc.hotes = NOUVEAU
    expect(await passe(ports, memoire)).toBe("confirmation-attendue")
    expect(banc.ecritures).toBe(0)
  })

  test("deux lectures concordantes écrivent, une fois", async () => {
    const { banc, ports } = bancDEssai()
    const memoire = memoireNeuve()
    expect(await deuxPasses(ports, memoire)).toBe("écrit")
    expect(banc.ecritures).toBe(1)
    expect(banc.fichier).toContain("Host(`neuf.fr`)")

    // Et la passe suivante ne réécrit pas : sans cette égalité, chaque tour
    // de boucle toucherait le fichier, Traefik rechargerait, et le quota
    // partirait en fumée sans qu'aucun domaine n'ait changé.
    expect(await passe(ports, memoire)).toBe("inchangé")
    expect(banc.ecritures).toBe(1)
  })
})

describe("les anciens hôtes survivent au changement", () => {
  test("tant que le nouveau ne sert pas de certificat valide, l'ancien reste routé", async () => {
    // Le piège numéro un : retirer l'ancien hôte pendant que le certificat
    // du nouveau s'émet rend l'administration injoignable sur les DEUX
    // domaines si Let's Encrypt échoue — et il n'existe alors plus aucun
    // moyen de revenir en arrière sans SSH.
    const { banc, ports } = bancDEssai(composerRoutes(ANCIEN, []))
    banc.certificatValide = false
    await deuxPasses(ports, memoireNeuve())

    expect(banc.fichier).toContain("Host(`neuf.fr`)")
    expect(banc.fichier).toContain("Host(`vieux.fr`)")
    expect(banc.fichier).toContain("Host(`admin.vieux.fr`)")
  })

  test("une fois le certificat servi, l'ancien part — à la passe SUIVANTE", async () => {
    const { banc, ports } = bancDEssai(composerRoutes(ANCIEN, []))
    banc.certificatValide = false
    await deuxPasses(ports, memoireNeuve())
    expect(banc.fichier).toContain("Host(`vieux.fr`)")

    banc.certificatValide = true
    await deuxPasses(ports, memoireNeuve())
    expect(banc.fichier).toContain("Host(`neuf.fr`)")
    expect(banc.fichier).not.toContain("vieux.fr")
  })

  test("une sonde qui échoue vaut « pas de certificat » — jamais un retrait", async () => {
    // Échec fermé, jusque dans la sonde : si l'on ne SAIT pas que le
    // nouvel hôte est joignable, on ne retire pas celui qui l'est.
    const { banc, ports } = bancDEssai(composerRoutes(ANCIEN, []))
    const portsQuiPlantent: Ports = {
      ...ports,
      sertUnCertificatValide: async () => {
        throw new Error("ECONNREFUSED")
      },
    }
    await deuxPasses(portsQuiPlantent, memoireNeuve())
    expect(banc.fichier).toContain("Host(`vieux.fr`)")
  })

  test("l'état « hôtes précédents » se relit DU FICHIER, pas de la mémoire", async () => {
    // Chaque appel part d'une `memoireNeuve()` : c'est un redémarrage du
    // conteneur entre deux passes. Une mémoire de processus perdrait alors
    // la liste des anciens hôtes et les retirerait du routage sans que rien
    // n'ait changé — exactement la panne que ce mécanisme empêche.
    const { banc, ports } = bancDEssai(composerRoutes(ANCIEN, []))
    banc.certificatValide = false
    await deuxPasses(ports, memoireNeuve())
    const apresLePremierDemarrage = banc.fichier

    await deuxPasses(ports, memoireNeuve())
    expect(banc.fichier).toBe(apresLePremierDemarrage)
    expect(banc.fichier).toContain("Host(`vieux.fr`)")
  })

  test("un hôte illisible dans le fichier est écarté, pas propagé", async () => {
    // Le fichier est le nôtre, mais il est sur un volume : une valeur
    // douteuse qui y arriverait ne doit ni entrer dans une règle de
    // routage, ni bloquer pour toujours l'écriture du routage correct.
    const { banc, ports } = bancDEssai(
      composerRoutes(ANCIEN, []).replace("Host(`vieux.fr`)", "Host(`pas-un-hôte`)"),
    )
    await deuxPasses(ports, memoireNeuve())
    expect(banc.fichier).toContain("Host(`neuf.fr`)")
    expect(banc.fichier).not.toContain("pas-un-hôte")
    // L'autre ancien hôte, lui, est parfaitement lisible et reste routé :
    // écarter la valeur douteuse n'est pas jeter le fichier.
    expect(banc.fichier).toContain("Host(`admin.vieux.fr`)")
  })
})

describe("les anciens hôtes ne s'accumulent pas sans borne", () => {
  test("le nombre d'anciens hôtes gardés par service est plafonné à MAX_SORTANTS", async () => {
    // Constat 3 (relecture finale) : tant qu'aucun nouveau domaine
    // n'obtient de certificat, chaque changement ajoutait deux `Host()` de
    // plus, INDÉFINIMENT — et Traefik tente d'obtenir un certificat pour
    // chacun, donc consomme le quota Let's Encrypt sans fin. La borne est
    // `MAX_SORTANTS` (`lib/hotesSortants.ts`), la même que la chaîne des
    // origines sortantes, appliquée PAR SERVICE — voir `passe.ts` à
    // l'endroit où `anciens` est calculé pour la raison du « par service ».
    const { banc, ports } = bancDEssai(null)
    banc.certificatValide = false
    const memoire = memoireNeuve()

    const hotesRound = (i: number): Hotes => ({
      web: `d${i}.fr`,
      admin: `admin.d${i}.fr`,
      umami: null,
    })

    // Largement plus que MAX_SORTANTS changements de domaine, aucun
    // n'obtenant jamais de certificat — le cas qui suppose une répétition
    // d'erreurs (décrit comme mineur dans le rapport), mais sans plafond il
    // n'a AUCUNE fin.
    const dernier = MAX_SORTANTS + 4
    for (let i = 1; i <= dernier; i++) {
      banc.hotes = hotesRound(i)
      await deuxPasses(ports, memoire)
    }

    const hotes = hotesDuFichier(banc.fichier)
    const anciensWeb = hotes.filter((h) => /^d\d+\.fr$/.test(h) && h !== `d${dernier}.fr`)
    const anciensAdmin = hotes.filter(
      (h) => /^admin\.d\d+\.fr$/.test(h) && h !== `admin.d${dernier}.fr`,
    )
    expect(anciensWeb).toHaveLength(MAX_SORTANTS)
    expect(anciensAdmin).toHaveLength(MAX_SORTANTS)

    // Et ça ne bouge plus : plusieurs changements de plus ne font pas
    // grandir la liste davantage — c'est un plafond, pas un simple retard.
    const tailleApresPlafond = hotes.length
    for (let i = dernier + 1; i <= dernier + 3; i++) {
      banc.hotes = hotesRound(i)
      await deuxPasses(ports, memoire)
    }
    expect(hotesDuFichier(banc.fichier)).toHaveLength(tailleApresPlafond)
  })

  test("un ancien hôte d'administration n'est pas sacrifié parce que `web` a plus d'histoire", async () => {
    // Le danger d'un plafond GLOBAL plutôt que PAR SERVICE : `web` est
    // toujours écrit AVANT `admin` dans le fichier (`SERVICES`,
    // `ecrireRoutes.ts`), donc un plafond appliqué à la liste à plat
    // piocherait ses `MAX_SORTANTS` places entièrement du côté `web` dès
    // que celui-ci en accumule plus à lui seul — et laisserait tomber le
    // dernier ancien hôte `admin` encore joignable. C'est précisément le
    // dashboard verrouillé que le point 2 de l'en-tête de `passe.ts` existe
    // pour empêcher : ce test échoue sous un plafond global, et passe sous
    // un plafond par service.
    const { banc, ports } = bancDEssai(null)
    banc.certificatValide = false
    const memoire = memoireNeuve()

    // Un premier admin, qui va devenir l'unique ancien hôte d'admin —
    // nommé selon la convention (`admin.<domaine>`) pour que
    // `serviceDeLAncienHote` le reconnaisse bien comme un hôte d'ADMIN et
    // non de web.
    banc.hotes = { web: "d0.fr", admin: "admin.d0.fr", umami: null }
    await deuxPasses(ports, memoire)

    // `admin` se fixe une fois pour toutes ; SEUL `web` change ensuite, et
    // plus de fois que `MAX_SORTANTS` — de quoi remplir, puis dépasser, le
    // plafond `web` à lui seul, pendant que `admin.d0.fr` reste l'unique
    // ancien hôte d'admin, jamais renouvelé.
    const dernier = MAX_SORTANTS + 3
    for (let i = 1; i <= dernier; i++) {
      banc.hotes = { web: `d${i}.fr`, admin: "admin.stable.fr", umami: null }
      await deuxPasses(ports, memoire)
    }

    expect(banc.fichier).toContain("Host(`admin.d0.fr`)")
  })
})

describe("il ne fait rien d'autre", () => {
  // Une propriété d'ABSENCE ne s'observe pas en exécutant : un service qui
  // n'ouvre pas de port ne produit aucun signal qu'on puisse attendre. Elle
  // se vérifie donc sur le texte du point d'entrée — imparfait, et honnête
  // à ce sujet : ce test attrape l'ajout délibéré d'un serveur ou du socket
  // Docker, pas une dépendance qui en ouvrirait un pour son compte.
  const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8")

  test("aucun serveur, aucun port à l'écoute", () => {
    expect(source).not.toMatch(/createServer|\.listen\(|node:http\b|node:net\b/)
  })

  test("aucun accès au socket Docker", () => {
    // Un socket Docker accessible depuis un conteneur équivaut à lui donner
    // le root de l'hôte. Ce service n'en a aucun besoin : il lit une query
    // et écrit un fichier.
    expect(source).not.toContain("docker.sock")
  })
})

describe("une passe ne tue jamais le processus", () => {
  test("un refus inattendu est journalisé, pas propagé", async () => {
    // `composerRoutes` REFUSE plutôt que de composer un YAML douteux, le
    // volume peut être en lecture seule, le disque plein. Un service de
    // routage qui meurt sur le premier de ces refus laisse le routage figé
    // à sa dernière valeur POUR TOUJOURS, sans que personne l'apprenne — et
    // il ne reste alors que SSH pour changer de domaine, ce que ce plan
    // existe précisément pour supprimer.
    const { banc, ports } = bancDEssai()
    const portsQuiLevent: Ports = {
      ...ports,
      ecrireRoutes: async () => {
        throw new Error("EROFS: read-only file system")
      },
    }
    const memoire = memoireNeuve()
    expect(await deuxPasses(portsQuiLevent, memoire)).toBe("refus")
    expect(banc.erreurs).toHaveLength(1)
    // La confirmation repart de zéro : on ne réécrira pas sur la foi d'une
    // lecture antérieure au refus.
    expect(memoire.derniere).toBeNull()
  })
})

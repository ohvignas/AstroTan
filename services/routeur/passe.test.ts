import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { composerRoutes } from "./ecrireRoutes"
import { memoireNeuve, passe, type Hotes, type Memoire, type Ports } from "./passe"

const ANCIEN: Hotes = { web: "vieux.fr", admin: "admin.vieux.fr", umami: null }
const NOUVEAU: Hotes = { web: "neuf.fr", admin: "admin.neuf.fr", umami: null }

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
    erreurs: [] as string[],
  }
  const ports: Ports = {
    lireHotes: async () => {
      if (banc.lectureEchoue) throw new Error("fetch failed")
      return banc.hotes
    },
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

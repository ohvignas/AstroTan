import { describe, expect, it } from "vitest"
import { comparerDomaines, normaliserDomaine } from "../../verifier-domaine.mjs"
import { domainesAutorises } from "./allowedDomains"

// `WEB_DOMAIN` vit des DEUX côtés : `astro.config.ts` la fige au BUILD dans
// `security.allowedDomains`, Traefik route dessus au RUNTIME. Rien ne
// détectait leur divergence, et le symptôme d'une divergence est nul :
// les deux moitiés répondent, le site sert, `/api/consent` répond 204 — et
// `clientAddress` retombe sur l'adresse de la socket, donc les deux
// limiteurs de débit du site repartagent un seul seau pour tout Internet.
// Mesuré : avec un `Host:` non appris au build, l'empreinte transmise est
// celle de Traefik, pas celle du visiteur.

describe("normaliserDomaine", () => {
  // LE test de ce fichier, et la raison pour laquelle il existe : la
  // normalisation du garde-fou et celle d'`allowedDomains.ts` sont deux
  // écritures de la même règle. Deux écritures qui peuvent diverger sont
  // exactement le défaut qu'on est en train de fermer — celui-ci les
  // épingle l'une à l'autre.
  it("rend le même hôte que `domainesAutorises`, pour que les deux moitiés ne divergent pas", () => {
    for (const brut of ["exemple.fr", "Exemple.FR", "  exemple.fr  ", "SOUS.exemple.fr"]) {
      expect(normaliserDomaine(brut)).toBe(domainesAutorises(brut)[0]?.hostname)
    }
  })

  it("rend la chaîne vide pour une variable absente", () => {
    expect(normaliserDomaine(undefined)).toBe("")
    expect(normaliserDomaine("   ")).toBe("")
  })
})

describe("comparerDomaines", () => {
  it("laisse démarrer quand les deux moitiés concordent", () => {
    expect(
      comparerDomaines({ hotesDuBuild: ["exemple.fr"], domaineDuRuntime: "exemple.fr" }),
    ).toBeNull()
  })

  it("laisse démarrer malgré la casse et les espaces — ce n'est pas une divergence", () => {
    expect(
      comparerDomaines({ hotesDuBuild: ["exemple.fr"], domaineDuRuntime: "  Exemple.FR " }),
    ).toBeNull()
  })

  it("refuse quand le runtime sert un domaine que le build n'a pas appris", () => {
    const refus = comparerDomaines({
      hotesDuBuild: ["ancien.exemple.fr"],
      domaineDuRuntime: "nouveau.exemple.fr",
    })
    // Les DEUX valeurs dans le message : un refus qui n'en nomme qu'une
    // laisse chercher laquelle des deux moitiés a bougé.
    expect(refus).toContain("ancien.exemple.fr")
    expect(refus).toContain("nouveau.exemple.fr")
  })

  it("refuse quand `WEB_DOMAIN` est absente au runtime", () => {
    expect(comparerDomaines({ hotesDuBuild: ["exemple.fr"], domaineDuRuntime: undefined })).toContain(
      "exemple.fr",
    )
  })

  it("refuse quand le build n'a appris aucun hôte", () => {
    // L'image de production ne peut pas se construire dans cet état
    // (`RUN test -n "$WEB_DOMAIN"`), donc y arriver signifie que quelque
    // chose d'autre a cédé. Démarrer quand même redonnerait précisément la
    // panne muette que tout ceci existe pour fermer.
    expect(comparerDomaines({ hotesDuBuild: [], domaineDuRuntime: "exemple.fr" })).toBeTruthy()
  })
})

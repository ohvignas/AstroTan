import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import schema from "./schema"
import { api } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  // Explicitement retirée, jamais supposée absente : la machine qui lance
  // la suite peut très bien porter une vraie clé Resend dans son shell, et
  // un test qui n'en tient pas compte partirait interroger api.resend.com
  // pour de bon — exactement ce que ce fichier existe pour ne pas faire.
  delete process.env.RESEND_API_KEY
})

afterEach(() => {
  process.env = originalEnv
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor",
) {
  const email = `resenddomain-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple resend"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id }
}

/** Ce qu'on retient d'un appel sortant, pour pouvoir l'affirmer ensuite. */
type Appel = {
  url: string
  methode: string
  autorisation: string | null
  corps: unknown
  /** Une borne de temps a-t-elle été posée ? (`AbortSignal.timeout`) */
  borne: boolean
}

/**
 * Un faux `fetch` qui enregistre ce qu'on lui demande.
 *
 * Même mesure que `dns.test.ts` pour le résolveur : la suite ne touche
 * jamais api.resend.com. Déclarer un domaine est une ÉCRITURE chez un
 * tiers — un test qui la ferait pour de bon salirait le compte Resend de
 * qui lance la suite.
 */
function stubResend(
  repondre: (appel: Appel) => { status: number; body: unknown },
): Appel[] {
  const appels: Appel[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const appel: Appel = {
        url: String(url),
        methode: init?.method ?? "GET",
        autorisation: new Headers(init?.headers).get("authorization"),
        corps:
          init?.body === undefined || init.body === null
            ? undefined
            : JSON.parse(String(init.body)),
        borne: init?.signal != null,
      }
      appels.push(appel)
      const { status, body } = repondre(appel)
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
    }),
  )
  return appels
}

/** Les trois lignes que Resend rend pour un domaine d'expédition. */
const RECORDS = [
  {
    record: "SPF",
    name: "send",
    type: "MX",
    ttl: "Auto",
    status: "not_started",
    value: "feedback-smtp.us-east-1.amazonses.com",
    priority: 10,
  },
  {
    record: "SPF",
    name: "send",
    type: "TXT",
    ttl: "Auto",
    status: "not_started",
    value: "v=spf1 include:amazonses.com ~all",
  },
  {
    record: "DKIM",
    name: "resend._domainkey",
    type: "TXT",
    ttl: "Auto",
    status: "not_started",
    value: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQ",
  },
]

/**
 * Un compte Resend simulé, avec la vraie mécanique qui compte ici :
 * un POST sur un domaine déjà présent rend 403 `validation_error`
 * « has been registered already » (table des erreurs de la référence
 * Resend), et non un succès.
 */
function fauxCompte(initiaux: string[] = []) {
  const domaines = initiaux.map((name, i) => ({ id: `dom_${i}`, name }))
  const repondre = (appel: Appel): { status: number; body: unknown } => {
    const u = new URL(appel.url)
    if (u.pathname === "/domains" && appel.methode === "POST") {
      const nom = (appel.corps as { name?: string } | undefined)?.name ?? ""
      if (domaines.some((d) => d.name === nom)) {
        return {
          status: 403,
          body: {
            statusCode: 403,
            name: "validation_error",
            message: `The \`${nom}\` domain has been registered already.`,
          },
        }
      }
      const cree = { id: `dom_${domaines.length}`, name: nom }
      domaines.push(cree)
      return {
        status: 201,
        body: { ...cree, status: "not_started", region: "eu-west-1", records: RECORDS },
      }
    }
    if (u.pathname === "/domains" && appel.methode === "GET") {
      return {
        status: 200,
        body: {
          object: "list",
          has_more: false,
          data: domaines.map((d) => ({ ...d, status: "pending" })),
        },
      }
    }
    const un = /^\/domains\/([^/]+)$/.exec(u.pathname)
    if (un && appel.methode === "GET") {
      const trouve = domaines.find((d) => d.id === un[1])
      if (trouve === undefined) return { status: 404, body: { name: "not_found" } }
      return {
        status: 200,
        body: {
          object: "domain",
          ...trouve,
          status: "pending",
          region: "eu-west-1",
          records: RECORDS,
        },
      }
    }
    return { status: 404, body: { name: "not_found" } }
  }
  return { domaines, repondre }
}

// --- Autorisation --------------------------------------------------------

test("declarer : un editor est refusé", async () => {
  const t = makeTestConvex()
  const editor = await seedActor(t, "editor")
  const appels = stubResend(() => ({ status: 200, body: {} }))
  await expect(
    editor.identity.action(api.resendDomain.declarer, { domaine: "exemple.fr" }),
  ).rejects.toThrow(/FORBIDDEN/)
  // Le refus tombe AVANT le réseau : une action qui appelle un tiers avec
  // la clé du déploiement ne doit pas le faire pour un appelant refusé.
  expect(appels).toEqual([])
})

test("declarer : un appelant sans session est refusé", async () => {
  const t = makeTestConvex()
  const appels = stubResend(() => ({ status: 200, body: {} }))
  await expect(
    t.action(api.resendDomain.declarer, { domaine: "exemple.fr" }),
  ).rejects.toThrow(/UNAUTHENTICATED/)
  expect(appels).toEqual([])
})

// --- Les refus qui n'appellent personne ----------------------------------

test("declarer : sans clé Resend, on le dit — sans rien appeler", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  const appels = stubResend(() => ({ status: 200, body: {} }))
  const resultat = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })
  expect(resultat).toEqual({ etat: "sans_cle" })
  expect(appels).toEqual([])
})

test("declarer : un domaine qui n'est pas un hôte nu est refusé avant tout appel", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  const appels = stubResend(() => ({ status: 200, body: {} }))
  await expect(
    admin.identity.action(api.resendDomain.declarer, {
      domaine: "https://exemple.fr/chemin",
    }),
  ).rejects.toThrow(/INVALID_DOMAIN/)
  // Valider après le premier `fetch` ferait de ce champ de saisie un moyen
  // de faire émettre des requêtes arbitraires depuis ce déploiement.
  expect(appels).toEqual([])
})

// --- Le cas neuf : le domaine n'est pas encore déclaré --------------------

test("declarer : un domaine inconnu est créé, et ses lignes DNS reviennent", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  const compte = fauxCompte()
  const appels = stubResend(compte.repondre)

  const resultat = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })

  if (resultat.etat !== "ok") throw new Error(`attendu ok, reçu ${resultat.etat}`)
  expect(resultat.dejaDeclare).toBe(false)
  expect(compte.domaines.map((d) => d.name)).toEqual(["exemple.fr"])
  expect(appels.some((a) => a.methode === "POST")).toBe(true)
  // La forme que le tableau de `/settings/domaine` consomme déjà —
  // celle que `dns.plan` rend : type / nom / valeur, en champs séparés.
  expect(resultat.enregistrements.map((e) => [e.type, e.nom])).toEqual([
    ["MX", "send.exemple.fr"],
    ["TXT", "send.exemple.fr"],
    ["TXT", "resend._domainkey.exemple.fr"],
  ])
})

test("declarer : le nom relatif de Resend devient l'hôte complet à créer", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  stubResend(fauxCompte().repondre)
  const resultat = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })
  if (resultat.etat !== "ok") throw new Error("attendu ok")
  // `resend._domainkey` seul, recopié tel quel dans une zone, crée
  // `resend._domainkey.resend._domainkey.exemple.fr` chez la moitié des
  // hébergeurs. Le nom complet est la seule forme qui se copie sans piège.
  const dkim = resultat.enregistrements.find((e) =>
    e.nom.startsWith("resend._domainkey"),
  )
  expect(dkim?.nom).toBe("resend._domainkey.exemple.fr")
})

test("declarer : la priorité d'un MX ne se perd pas en route", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  stubResend(fauxCompte().repondre)
  const resultat = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })
  if (resultat.etat !== "ok") throw new Error("attendu ok")
  const mx = resultat.enregistrements.find((e) => e.type === "MX")
  // Un MX sans priorité ne se saisit pas : le formulaire de zone la
  // réclame, et l'omettre fait créer un enregistrement inutilisable.
  expect(mx?.attendu).toContain("feedback-smtp.us-east-1.amazonses.com")
  expect(mx?.attendu).toContain("10")
})

test("declarer : chaque ligne porte une clé stable et distincte", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  stubResend(fauxCompte().repondre)
  const resultat = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })
  if (resultat.etat !== "ok") throw new Error("attendu ok")
  const cles = resultat.enregistrements.map((e) => e.cle)
  // Deux lignes SPF (un MX et un TXT) portent le même `name` chez Resend :
  // une clé bâtie sur le seul nom les confondrait, et le tableau de la
  // tâche 8 (qui s'y accroche) en perdrait une.
  expect(new Set(cles).size).toBe(cles.length)
})

// --- Le cas fréquent : le domaine est déjà déclaré ------------------------

test("declarer : un domaine déjà déclaré ne provoque AUCUNE écriture", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  const compte = fauxCompte(["exemple.fr"])
  const appels = stubResend(compte.repondre)

  const resultat = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })

  if (resultat.etat !== "ok") throw new Error(`attendu ok, reçu ${resultat.etat}`)
  expect(resultat.dejaDeclare).toBe(true)
  expect(resultat.enregistrements.length).toBe(3)
  // C'est le cas le plus fréquent — le deuxième passage sur l'écran. On
  // regarde avant d'écrire, donc aucun POST ne part.
  expect(appels.map((a) => a.methode)).toEqual(["GET", "GET"])
})

test("declarer : deux appels de suite ne créent qu'un seul domaine", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  const compte = fauxCompte()
  const appels = stubResend(compte.repondre)

  const un = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })
  const deux = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })

  if (un.etat !== "ok" || deux.etat !== "ok") throw new Error("attendu ok deux fois")
  expect(un.dejaDeclare).toBe(false)
  expect(deux.dejaDeclare).toBe(true)
  expect(compte.domaines.length).toBe(1)
  expect(appels.filter((a) => a.methode === "POST").length).toBe(1)
  // La seconde réponse porte les mêmes lignes que la première : l'écran ne
  // change pas d'avis entre deux visites.
  expect(deux.enregistrements).toEqual(un.enregistrements)
})

test("declarer : « registered already » en réponse au POST est un succès, pas un échec", async () => {
  // La course : le domaine apparaît chez Resend entre notre lecture et
  // notre écriture (un autre onglet, un collègue, le tableau de bord
  // Resend). L'API le refuse par 403 — le traiter comme une panne rendrait
  // l'écran inutilisable au pire moment.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  const compte = fauxCompte()
  let premiereListe = true
  const appels = stubResend((appel) => {
    const u = new URL(appel.url)
    if (u.pathname === "/domains" && appel.methode === "GET" && premiereListe) {
      premiereListe = false
      // La liste est vide : à cet instant, le domaine n'existe pas encore.
      return { status: 200, body: { object: "list", has_more: false, data: [] } }
    }
    if (u.pathname === "/domains" && appel.methode === "POST") {
      // Entre-temps, quelqu'un l'a déclaré.
      compte.domaines.push({ id: "dom_course", name: "exemple.fr" })
    }
    return compte.repondre(appel)
  })

  const resultat = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })

  if (resultat.etat !== "ok") throw new Error(`attendu ok, reçu ${resultat.etat}`)
  expect(resultat.dejaDeclare).toBe(true)
  expect(resultat.enregistrements.length).toBe(3)
  expect(appels.filter((a) => a.methode === "POST").length).toBe(1)
})

test("declarer : déclaré ailleurs et invisible avec cette clé se dit, sans mentir", async () => {
  // Resend refuse le POST parce que le domaine existe, mais la clé
  // employée ne le voit pas : il appartient à un autre compte ou à une
  // autre équipe. Rendre « ok » avec zéro ligne ferait croire à un domaine
  // sans enregistrement à créer.
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  stubResend((appel) => {
    const u = new URL(appel.url)
    if (u.pathname === "/domains" && appel.methode === "GET") {
      return { status: 200, body: { object: "list", has_more: false, data: [] } }
    }
    return {
      status: 403,
      body: {
        statusCode: 403,
        name: "validation_error",
        message: "The `exemple.fr` domain has been registered already.",
      },
    }
  })
  const resultat = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })
  expect(resultat).toEqual({ etat: "introuvable" })
})

// --- Ce que le service répond quand il dit non ---------------------------

test("declarer : une clé d'envoi seul ne peut pas déclarer, et on le distingue", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_restreinte"
  stubResend(() => ({
    status: 401,
    body: { statusCode: 401, name: "restricted_api_key", message: "restricted" },
  }))
  const resultat = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })
  // `secretCheck.essayer` accepte une clé restreinte — elle envoie très
  // bien des emails. Ici elle ne suffit pas, et confondre les deux refus
  // enverrait l'adoptant régénérer une clé qui marche.
  expect(resultat).toEqual({ etat: "cle_restreinte" })
})

test("declarer : une clé invalide est un refus", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_fausse"
  stubResend(() => ({
    status: 400,
    body: { statusCode: 400, name: "validation_error", message: "API key is invalid" },
  }))
  const resultat = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })
  expect(resultat).toEqual({ etat: "refuse" })
})

test("declarer : un 429 ou un 5xx n'accuse pas la clé", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  for (const status of [429, 500, 503]) {
    stubResend(() => ({ status, body: { name: "service_unavailable" } }))
    const resultat = await admin.identity.action(api.resendDomain.declarer, {
      domaine: "exemple.fr",
    })
    expect(resultat).toEqual({ etat: "injoignable" })
  }
})

test("declarer : une panne réseau rend injoignable, jamais une exception", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network down")
    }),
  )
  const resultat = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })
  expect(resultat).toEqual({ etat: "injoignable" })
})

// --- Les deux contraintes de la tâche, affirmées ------------------------

test("declarer : chaque appel sortant porte une borne de temps", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  const appels = stubResend(fauxCompte(["exemple.fr"]).repondre)
  await admin.identity.action(api.resendDomain.declarer, { domaine: "exemple.fr" })
  expect(appels.length).toBeGreaterThan(0)
  // Sans borne, une réponse qui ne vient jamais tient l'action jusqu'au
  // délai d'exécution de Convex, et l'écran ne dit rien pendant ce temps.
  expect(appels.every((a) => a.borne)).toBe(true)
})

test("declarer : la clé saisie dans l'administration est celle qui sert", async () => {
  // LE défaut corrigé sur `leads.ts` cette semaine : la garde lisait
  // `process.env` pendant que le client lisait la base. Une clé saisie à
  // l'écran envoyait les invitations et pas les notifications.
  const t = makeTestConvex()
  process.env.SECRETS_KEY = Buffer.alloc(32, 9).toString("base64")
  const owner = await seedActor(t, "owner")
  await owner.identity.action(api.secrets.set, {
    nom: "RESEND_API_KEY",
    valeur: "re_depuis_la_base",
  })
  expect(process.env.RESEND_API_KEY).toBeUndefined()

  const appels = stubResend(fauxCompte(["exemple.fr"]).repondre)
  const resultat = await owner.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })

  expect(resultat.etat).toBe("ok")
  expect(appels.length).toBeGreaterThan(0)
  expect(appels.every((a) => a.autorisation === "Bearer re_depuis_la_base")).toBe(true)
})

test("declarer : la variable d'environnement l'emporte sur la base", async () => {
  // La précédence est celle de `lireSecret`, et elle n'est décidée qu'à
  // cet endroit-là. Ce test échoue si ce module se met à lire la base
  // directement, ou l'environnement directement.
  const t = makeTestConvex()
  process.env.SECRETS_KEY = Buffer.alloc(32, 9).toString("base64")
  const owner = await seedActor(t, "owner")
  await owner.identity.action(api.secrets.set, {
    nom: "RESEND_API_KEY",
    valeur: "re_depuis_la_base",
  })
  process.env.RESEND_API_KEY = "re_depuis_lenv"

  const appels = stubResend(fauxCompte(["exemple.fr"]).repondre)
  await owner.identity.action(api.resendDomain.declarer, { domaine: "exemple.fr" })
  expect(appels.every((a) => a.autorisation === "Bearer re_depuis_lenv")).toBe(true)
})

test("declarer : un owner passe", async () => {
  const t = makeTestConvex()
  const owner = await seedActor(t, "owner")
  process.env.RESEND_API_KEY = "re_test_env"
  stubResend(fauxCompte(["exemple.fr"]).repondre)
  const resultat = await owner.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })
  expect(resultat.etat).toBe("ok")
})

test("declarer : le domaine est normalisé avant d'être déclaré", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  const compte = fauxCompte()
  stubResend(compte.repondre)
  // Point final (forme absolue) et majuscules : deux formes qui se
  // collent à un copier-coller depuis une zone DNS. Les envoyer telles
  // quelles déclarerait deux domaines distincts chez Resend.
  await admin.identity.action(api.resendDomain.declarer, { domaine: "Exemple.FR." })
  expect(compte.domaines.map((d) => d.name)).toEqual(["exemple.fr"])
})

test("declarer : le statut de vérification rendu par Resend remonte", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  stubResend(fauxCompte(["exemple.fr"]).repondre)
  const resultat = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })
  if (resultat.etat !== "ok") throw new Error("attendu ok")
  // Sans lui, l'écran ne sait pas dire « Resend vérifie encore » plutôt
  // que « c'est en place ».
  expect(resultat.statut).toBe("pending")
})

test("declarer : un type DNS que Resend inventerait est compté, pas caché", async () => {
  const t = makeTestConvex()
  const admin = await seedActor(t, "admin")
  process.env.RESEND_API_KEY = "re_test_env"
  stubResend((appel) => {
    const u = new URL(appel.url)
    if (u.pathname === "/domains" && appel.methode === "GET") {
      return {
        status: 200,
        body: {
          object: "list",
          has_more: false,
          data: [{ id: "dom_0", name: "exemple.fr", status: "pending" }],
        },
      }
    }
    return {
      status: 200,
      body: {
        object: "domain",
        id: "dom_0",
        name: "exemple.fr",
        status: "pending",
        records: [
          ...RECORDS,
          { record: "Futur", name: "svcb", type: "SVCB", value: "1 .", status: "not_started" },
        ],
      },
    }
  })
  const resultat = await admin.identity.action(api.resendDomain.declarer, {
    domaine: "exemple.fr",
  })
  if (resultat.etat !== "ok") throw new Error("attendu ok")
  expect(resultat.enregistrements.length).toBe(3)
  // Une ligne écartée en silence, c'est un enregistrement que l'adoptant
  // ne créera jamais et une vérification qui restera rouge sans raison
  // visible. Le compte permet à l'écran de le dire.
  expect(resultat.ignores).toBe(1)
})

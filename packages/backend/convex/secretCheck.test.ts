import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api } from "./_generated/api"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

// ---------------------------------------------------------------------
// L'essai d'un jeton avant son rangement.
//
// Deux frontières, et elles ne se recouvrent pas :
//
//   1. **La lecture des codes de Resend.** Le cas qui fait tout l'intérêt
//      de ce fichier est `400 validation_error` : c'est ce que l'API rend
//      pour une clé inexistante ou tronquée, ce n'est PAS dans la table
//      des erreurs de sa documentation, et une règle « 401 = refus »
//      écrite depuis la seule documentation aurait donc accepté une clé
//      bidon. Le pendant est `401 restricted_api_key`, qui est une clé
//      VALIDE — la refuser couperait les envois d'un déploiement dont la
//      clé n'a que le droit d'envoyer, c'est-à-dire le cas recommandé.
//
//   2. **Ce qui ne sort pas.** Ni le jeton, ni le message du service. Le
//      verdict est une décision, pas un rapport.
//
// `fetch` est remplacé par `vi.stubGlobal` : aucun test de cette suite ne
// doit sortir sur le réseau. Le test « sans vérificateur » vérifie qu'il
// n'y a même pas d'appel.
// ---------------------------------------------------------------------

let originalEnv: NodeJS.ProcessEnv
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  process.env = originalEnv
  vi.unstubAllGlobals()
})

/** Une réponse HTTP minimale, comme l'API en rend une. */
function reponse(status: number, corps: unknown = {}): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json" },
  })
}

async function seedActor(role: "owner" | "admin" | "editor") {
  const t = makeTestConvex()
  const email = `check-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple check"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { t, identity: await identityFor(t, user.id) }
}

const CLE = "re_CLE_QUI_NE_DOIT_JAMAIS_RESSORTIR_9876"

// ---------------------------------------------------------------------
// Rôles
// ---------------------------------------------------------------------

test("sans session, on n'essaie rien", async () => {
  const t = makeTestConvex()
  await expect(
    t.action(api.secretCheck.essayer, { nom: "RESEND_API_KEY", valeur: CLE })
  ).rejects.toThrow()
  // Le refus tombe AVANT l'appel sortant : une action qui interroge un
  // tiers avec la valeur d'un inconnu serait un relais ouvert.
  expect(fetchMock).not.toHaveBeenCalled()
})

test("un editor est refusé, et rien ne part sur le réseau", async () => {
  const { identity } = await seedActor("editor")
  await expect(
    identity.action(api.secretCheck.essayer, { nom: "RESEND_API_KEY", valeur: CLE })
  ).rejects.toThrow(/FORBIDDEN/)
  expect(fetchMock).not.toHaveBeenCalled()
})

// ---------------------------------------------------------------------
// Le jeton sans vérificateur : il ne prétend rien
// ---------------------------------------------------------------------

test("un jeton sans vérificateur rend « sans_verificateur », sans appel sortant", async () => {
  const { identity } = await seedActor("owner")
  const verdict = await identity.action(api.secretCheck.essayer, {
    nom: "UMAMI_API_PASSWORD",
    valeur: "un-mot-de-passe-umami",
  })
  expect(verdict).toEqual({ verdict: "sans_verificateur", service: null })
  // Le test qui compte : pas de vérificateur veut dire pas d'essai. Un
  // repli qui irait « voir quand même » quelque part rendrait ce verdict
  // faux dans les deux sens.
  expect(fetchMock).not.toHaveBeenCalled()
})

test("un nom inconnu de la liste des jetons n'ouvre aucun appel sortant", async () => {
  const { identity } = await seedActor("owner")
  const verdict = await identity.action(api.secretCheck.essayer, {
    nom: "https://exemple-malveillant.test/",
    valeur: CLE,
  })
  expect(verdict).toEqual({ verdict: "sans_verificateur", service: null })
  expect(fetchMock).not.toHaveBeenCalled()
})

// ---------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------

test("l'essai est un appel authentifié à l'endpoint documenté, avec une borne de temps", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(reponse(200, { data: [] }))

  await identity.action(api.secretCheck.essayer, { nom: "RESEND_API_KEY", valeur: CLE })

  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe("https://api.resend.com/api-keys")
  expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${CLE}`)
  // Sans borne, un serveur qui ne répond jamais tient l'action jusqu'à sa
  // propre limite, et l'écran reste en « envoi » sans rien dire.
  expect(init.signal).toBeInstanceOf(AbortSignal)
})

test("200 : la clé est valide", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(reponse(200, { data: [] }))
  await expect(
    identity.action(api.secretCheck.essayer, { nom: "RESEND_API_KEY", valeur: CLE })
  ).resolves.toEqual({ verdict: "valide", service: "Resend" })
})

test("400 « API key is invalid » : REFUSÉE — le cas que la documentation ne liste pas", async () => {
  // Le vrai comportement de l'API, mesuré : une clé inexistante rend 400,
  // pas 401. Une règle « 401 = refus » lue dans la seule table des
  // erreurs aurait accepté cette clé-là, c'est-à-dire la plus fréquente
  // des fautes de saisie.
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(
    reponse(400, { statusCode: 400, message: "API key is invalid", name: "validation_error" })
  )
  await expect(
    identity.action(api.secretCheck.essayer, { nom: "RESEND_API_KEY", valeur: CLE })
  ).resolves.toEqual({ verdict: "refuse", service: "Resend" })
})

test("401 restricted_api_key : VALIDE — une clé « Sending access » envoie très bien", async () => {
  // Elle s'est authentifiée ; elle n'a pas le droit de lister les clés.
  // C'est le réglage recommandé pour un serveur qui ne fait qu'envoyer :
  // la refuser interdirait de configurer le cas le plus sain.
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(
    reponse(401, {
      statusCode: 401,
      message: "This API key is restricted to only send emails.",
      name: "restricted_api_key",
    })
  )
  await expect(
    identity.action(api.secretCheck.essayer, { nom: "RESEND_API_KEY", valeur: CLE })
  ).resolves.toEqual({ verdict: "valide", service: "Resend" })
})

test("401 sans nom reconnu : refusée", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(
    reponse(401, { statusCode: 401, message: "Missing API Key", name: "missing_api_key" })
  )
  await expect(
    identity.action(api.secretCheck.essayer, { nom: "RESEND_API_KEY", valeur: CLE })
  ).resolves.toEqual({ verdict: "refuse", service: "Resend" })
})

test("403 : la clé existe mais n'enverra rien — refusée", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(
    reponse(403, { statusCode: 403, message: "This API key is suspended", name: "suspended_api_key" })
  )
  await expect(
    identity.action(api.secretCheck.essayer, { nom: "RESEND_API_KEY", valeur: CLE })
  ).resolves.toEqual({ verdict: "refuse", service: "Resend" })
})

// ---------------------------------------------------------------------
// « Le service n'a pas répondu » n'est pas « le service a dit non »
// ---------------------------------------------------------------------

test("429 et 5xx rendent « injoignable », jamais « refuse »", async () => {
  const { identity } = await seedActor("owner")
  for (const status of [429, 500, 503]) {
    fetchMock.mockResolvedValue(reponse(status, { message: "slow down" }))
    await expect(
      identity.action(api.secretCheck.essayer, { nom: "RESEND_API_KEY", valeur: CLE })
    ).resolves.toEqual({ verdict: "injoignable", service: "Resend" })
  }
})

test("un fetch qui lève, et un délai dépassé, rendent « injoignable »", async () => {
  const { identity } = await seedActor("owner")
  for (const panne of [
    new TypeError("network unreachable"),
    new DOMException("signal timed out", "TimeoutError"),
  ]) {
    fetchMock.mockRejectedValue(panne)
    await expect(
      identity.action(api.secretCheck.essayer, { nom: "RESEND_API_KEY", valeur: CLE })
    ).resolves.toEqual({ verdict: "injoignable", service: "Resend" })
  }
})

// ---------------------------------------------------------------------
// Ce qui ne sort pas
// ---------------------------------------------------------------------

test("le verdict ne porte ni le jeton, ni le message du service", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(
    reponse(400, {
      statusCode: 400,
      message: "API key is invalid",
      name: "validation_error",
    })
  )
  const verdict = await identity.action(api.secretCheck.essayer, {
    nom: "RESEND_API_KEY",
    valeur: CLE,
  })
  const json = JSON.stringify(verdict)
  expect(json).not.toContain(CLE)
  // Un message d'API tiers recopié à l'écran envoie chercher du côté des
  // permissions une faute qui est presque toujours un caractère perdu.
  expect(json).not.toContain("API key is invalid")
  expect(json).not.toContain("validation_error")
})

// ---------------------------------------------------------------------
// OpenRouter — GET /api/v1/key, documenté, 200 ou 401
// ---------------------------------------------------------------------

const CLE_OR = "sk-or-CLE_QUI_NE_DOIT_JAMAIS_RESSORTIR_9876"

test("OpenRouter : l'essai est un GET authentifié vers /api/v1/key", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(reponse(200, { data: { label: "sk-or-…" } }))

  await identity.action(api.secretCheck.essayer, {
    nom: "OPENROUTER_API_KEY",
    valeur: CLE_OR,
  })

  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe("https://openrouter.ai/api/v1/key")
  expect((init.headers as Record<string, string>).Authorization).toBe(
    `Bearer ${CLE_OR}`,
  )
  expect(init.signal).toBeInstanceOf(AbortSignal)
})

test("OpenRouter 200 : la clé est valide", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(reponse(200, { data: {} }))
  await expect(
    identity.action(api.secretCheck.essayer, {
      nom: "OPENROUTER_API_KEY",
      valeur: CLE_OR,
    }),
  ).resolves.toEqual({ verdict: "valide", service: "OpenRouter" })
})

test("OpenRouter 401 : refusée — rien n'est écrit, le corps ne sort pas", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(
    reponse(401, { error: { message: "User not found." } }),
  )
  const verdict = await identity.action(api.secretCheck.essayer, {
    nom: "OPENROUTER_API_KEY",
    valeur: CLE_OR,
  })
  expect(verdict).toEqual({ verdict: "refuse", service: "OpenRouter" })
  expect(JSON.stringify(verdict)).not.toContain(CLE_OR)
  expect(JSON.stringify(verdict)).not.toContain("User not found")
})

test("OpenRouter 503 : injoignable, pas un refus de clé", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(reponse(503, { message: "slow down" }))
  await expect(
    identity.action(api.secretCheck.essayer, {
      nom: "OPENROUTER_API_KEY",
      valeur: CLE_OR,
    }),
  ).resolves.toEqual({ verdict: "injoignable", service: "OpenRouter" })
})

test("vide et trop long sont refusés sans déranger le service", async () => {
  const { identity } = await seedActor("owner")
  for (const valeur of ["   ", "re_".padEnd(3000, "x")]) {
    await expect(
      identity.action(api.secretCheck.essayer, { nom: "RESEND_API_KEY", valeur })
    ).resolves.toEqual({ verdict: "refuse", service: "Resend" })
  }
  expect(fetchMock).not.toHaveBeenCalled()
})

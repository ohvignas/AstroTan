import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api } from "./_generated/api"
import { SECRETS_KEY_VAR } from "./lib/secretsCrypto"
import { DATAFORSEO_USER_DATA_URL, authorizationHeader } from "./lib/dataforseo"
import { MAX_SECRET_LENGTH } from "./secrets"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

let originalEnv: NodeJS.ProcessEnv
let fetchMock: ReturnType<typeof vi.fn>

const LOGIN = "login@exemple.fr"
const PASSWORD = "mot-de-passe-qui-ne-doit-jamais-ressortir"

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
  process.env[SECRETS_KEY_VAR] = Buffer.alloc(32, 7).toString("base64")
  delete process.env.DATAFORSEO_LOGIN
  delete process.env.DATAFORSEO_PASSWORD
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  process.env = originalEnv
  vi.unstubAllGlobals()
})

function reponse(status: number, corps: unknown = {}): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json" },
  })
}

async function seedActor(role: "owner" | "admin" | "editor") {
  const t = makeTestConvex()
  const email = `dfs-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple dataforseo"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { t, identity: await identityFor(t, user.id) }
}

test("sans session, on n'essaie rien", async () => {
  const t = makeTestConvex()
  await expect(
    t.action(api.dataforseo.enregistrer, { login: LOGIN, password: PASSWORD }),
  ).rejects.toThrow()
  expect(fetchMock).not.toHaveBeenCalled()
})

test("un editor est refusé, et rien ne part sur le réseau", async () => {
  const { identity } = await seedActor("editor")
  await expect(
    identity.action(api.dataforseo.enregistrer, { login: LOGIN, password: PASSWORD }),
  ).rejects.toThrow(/FORBIDDEN/)
  expect(fetchMock).not.toHaveBeenCalled()
})

test("vide et trop long sont refusés sans déranger le service", async () => {
  const { identity } = await seedActor("owner")
  for (const [login, password] of [
    ["", PASSWORD],
    [LOGIN, "   "],
    ["x".repeat(MAX_SECRET_LENGTH + 1), PASSWORD],
    [LOGIN, "y".repeat(MAX_SECRET_LENGTH + 1)],
  ] as const) {
    await expect(
      identity.action(api.dataforseo.enregistrer, { login, password }),
    ).resolves.toEqual({ verdict: "refuse" })
  }
  expect(fetchMock).not.toHaveBeenCalled()
  const etat = await identity.query(api.secrets.status, {})
  expect(etat.secrets.find((s) => s.nom === "DATAFORSEO_LOGIN")?.source).toBe("aucune")
  expect(etat.secrets.find((s) => s.nom === "DATAFORSEO_PASSWORD")?.source).toBe("aucune")
})

test("20000 : les deux secrets sont rangés, le mot de passe ne ressort pas", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(reponse(200, { status_code: 20000 }))
  const verdict = await identity.action(api.dataforseo.enregistrer, {
    login: LOGIN,
    password: PASSWORD,
  })
  expect(verdict).toEqual({ verdict: "valide" })
  expect(JSON.stringify(verdict)).not.toContain(PASSWORD)
  const [url] = fetchMock.mock.calls[0] as [string]
  expect(url).toBe(DATAFORSEO_USER_DATA_URL)
  const etat = await identity.query(api.secrets.status, {})
  expect(etat.secrets.find((s) => s.nom === "DATAFORSEO_LOGIN")?.source).toBe("base")
  expect(etat.secrets.find((s) => s.nom === "DATAFORSEO_PASSWORD")?.source).toBe("base")
  expect(JSON.stringify(etat)).not.toContain(PASSWORD)
  expect(JSON.stringify(etat)).not.toContain(LOGIN)
})

test("40100 : rien n'est enregistré", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(reponse(200, { status_code: 40100 }))
  await expect(
    identity.action(api.dataforseo.enregistrer, { login: LOGIN, password: PASSWORD }),
  ).resolves.toEqual({ verdict: "refuse" })
  const etat = await identity.query(api.secrets.status, {})
  expect(etat.secrets.find((s) => s.nom === "DATAFORSEO_LOGIN")?.source).toBe("aucune")
  expect(etat.secrets.find((s) => s.nom === "DATAFORSEO_PASSWORD")?.source).toBe("aucune")
})

test("panne réseau : injoignable, rien n'est enregistré", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockRejectedValue(new TypeError("network unreachable"))
  await expect(
    identity.action(api.dataforseo.enregistrer, { login: LOGIN, password: PASSWORD }),
  ).resolves.toEqual({ verdict: "injoignable" })
  const etat = await identity.query(api.secrets.status, {})
  expect(etat.secrets.find((s) => s.nom === "DATAFORSEO_LOGIN")?.source).toBe("aucune")
})

// ---------------------------------------------------------------------
// `identifiants` — ce que l'écran relit pour rouvrir le formulaire.
// ---------------------------------------------------------------------

test("identifiants est réservée à owner et admin", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.dataforseo.identifiants, {})).rejects.toThrow()
  const { identity } = await seedActor("editor")
  await expect(identity.query(api.dataforseo.identifiants, {})).rejects.toThrow(/FORBIDDEN/)
})

test("rien de posé : login null, passwordPose faux", async () => {
  const { identity } = await seedActor("admin")
  await expect(identity.query(api.dataforseo.identifiants, {})).resolves.toEqual({
    login: null,
    passwordPose: false,
  })
})

test("le login se relit en clair, le mot de passe jamais", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(reponse(200, { status_code: 20000 }))
  await identity.action(api.dataforseo.enregistrer, { login: LOGIN, password: PASSWORD })

  const rendu = await identity.query(api.dataforseo.identifiants, {})
  expect(rendu).toEqual({ login: LOGIN, passwordPose: true })
  expect(JSON.stringify(rendu)).not.toContain(PASSWORD)
})

test("l'environnement l'emporte sur la base, comme pour lireSecret", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(reponse(200, { status_code: 20000 }))
  await identity.action(api.dataforseo.enregistrer, { login: LOGIN, password: PASSWORD })

  process.env.DATAFORSEO_LOGIN = "depuis-lenvironnement@exemple.fr"
  await expect(identity.query(api.dataforseo.identifiants, {})).resolves.toEqual({
    login: "depuis-lenvironnement@exemple.fr",
    passwordPose: true,
  })
})

// ---------------------------------------------------------------------
// Le bouton doit pouvoir TESTER, pas seulement écrire.
//
// C'est la panne d'origine : seul `DATAFORSEO_LOGIN` était en base, le
// champ n'affichait qu'un masque, et « Enregistrer » restait grisé — donc
// aucun moyen d'essayer la connexion sans tout ressaisir. Un mot de passe
// laissé vide reprend celui qui est déjà rangé.
// ---------------------------------------------------------------------

test("mot de passe vide : celui déjà rangé sert, et le login se met à jour", async () => {
  const { identity } = await seedActor("owner")
  // `mockImplementation` et non `mockResolvedValue` : le corps d'une
  // `Response` ne se lit qu'une fois, et cette action est appelée deux fois.
  fetchMock.mockImplementation(async () => reponse(200, { status_code: 20000 }))
  await identity.action(api.dataforseo.enregistrer, { login: LOGIN, password: PASSWORD })
  fetchMock.mockClear()

  await expect(
    identity.action(api.dataforseo.enregistrer, { login: "autre@exemple.fr", password: "" }),
  ).resolves.toEqual({ verdict: "valide" })

  // Le mot de passe rangé a bien servi à l'appel sortant.
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect((init.headers as Record<string, string>).Authorization).toBe(
    authorizationHeader("autre@exemple.fr", PASSWORD),
  )

  await expect(identity.query(api.dataforseo.identifiants, {})).resolves.toEqual({
    login: "autre@exemple.fr",
    passwordPose: true,
  })
})

test("mot de passe vide et aucun rangé : refus avant tout appel", async () => {
  const { identity } = await seedActor("owner")
  await expect(
    identity.action(api.dataforseo.enregistrer, { login: LOGIN, password: "" }),
  ).resolves.toEqual({ verdict: "refuse" })
  expect(fetchMock).not.toHaveBeenCalled()
})

test("mot de passe vide et identifiants refusés : le login rangé ne change pas", async () => {
  const { identity } = await seedActor("owner")
  fetchMock.mockResolvedValue(reponse(200, { status_code: 20000 }))
  await identity.action(api.dataforseo.enregistrer, { login: LOGIN, password: PASSWORD })

  fetchMock.mockResolvedValue(reponse(200, { status_code: 40100 }))
  await expect(
    identity.action(api.dataforseo.enregistrer, { login: "faux@exemple.fr", password: "" }),
  ).resolves.toEqual({ verdict: "refuse" })

  await expect(identity.query(api.dataforseo.identifiants, {})).resolves.toEqual({
    login: LOGIN,
    passwordPose: true,
  })
})

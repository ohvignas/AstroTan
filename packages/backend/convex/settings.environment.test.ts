import { afterEach, beforeEach, expect, test } from "vitest"
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
})

afterEach(() => {
  process.env = originalEnv
})

async function seedActor(role: "owner" | "admin" | "editor") {
  const t = makeTestConvex()
  const email = `env-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple environment"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { t, identity: await identityFor(t, user.id) }
}

// ---------------------------------------------------------------------
// `settings.environment` répond à une seule question : « telle intégration
// est-elle configurée sur ce déploiement ? » — jamais « avec quelle
// valeur ».
//
// Ce fichier est le garde-fou de cette frontière. L'écran des réglages
// affiche l'état des clés (OpenRouter, Resend, Umami) parce qu'un opérateur
// ne peut pas deviner ce que `convex env set` a reçu ; il ne les affiche
// PAS, parce qu'une clé lue dans un navigateur est une clé qui a fuité —
// c'est exactement l'accident que `settings.publicProjection.test.ts`
// raconte pour le secret du webhook.
// ---------------------------------------------------------------------

test("environment exige une session", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.settings.environment, {})).rejects.toThrow()
})

test("environment ne rend jamais la valeur d'un secret", async () => {
  const { identity } = await seedActor("owner")

  process.env.OPENROUTER_API_KEY = "sk-or-v1-valeur-qui-ne-doit-jamais-sortir"
  process.env.RESEND_API_KEY = "re_valeur-qui-ne-doit-jamais-sortir"
  process.env.UMAMI_API_URL = "https://stats.exemple.fr"
  process.env.UMAMI_API_WEBSITE_ID = "site-1"
  process.env.UMAMI_API_USERNAME = "lecteur"
  process.env.UMAMI_API_PASSWORD = "motdepasse-qui-ne-doit-jamais-sortir"
  process.env.CONSENT_LOG_SECRET = "consent-secret-qui-ne-doit-jamais-sortir"

  const state = await identity.query(api.settings.environment, {})

  // L'état est bien vu : sans cette moitié, un `return {}` ferait passer
  // l'assertion de non-fuite ci-dessous sans rien garder du tout.
  expect(state.openRouter.configured).toBe(true)
  expect(state.resend.configured).toBe(true)
  expect(state.umamiApi.configured).toBe(true)
  expect(state.consentLog.configured).toBe(true)

  const rendu = JSON.stringify(state)
  for (const secret of [
    "sk-or-v1-valeur-qui-ne-doit-jamais-sortir",
    "re_valeur-qui-ne-doit-jamais-sortir",
    "motdepasse-qui-ne-doit-jamais-sortir",
    "consent-secret-qui-ne-doit-jamais-sortir",
    "lecteur",
  ]) {
    expect(rendu).not.toContain(secret)
  }
})

test("environment dit « non configuré » plutôt que de laisser deviner", async () => {
  const { identity } = await seedActor("admin")

  delete process.env.OPENROUTER_API_KEY
  delete process.env.RESEND_API_KEY
  delete process.env.CONSENT_LOG_SECRET
  // Une seule des quatre variables Umami manquantes suffit : une
  // intégration à moitié configurée échoue au moment de l'appel, là où
  // « non configurée » est une réponse nette (voir `readUmamiConfig`).
  process.env.UMAMI_API_URL = "https://stats.exemple.fr"
  delete process.env.UMAMI_API_WEBSITE_ID
  delete process.env.UMAMI_API_USERNAME
  delete process.env.UMAMI_API_PASSWORD

  const state = await identity.query(api.settings.environment, {})

  expect(state.openRouter.configured).toBe(false)
  expect(state.resend.configured).toBe(false)
  expect(state.consentLog.configured).toBe(false)
  expect(state.umamiApi.configured).toBe(false)
})

test("environment rend le mode d'essai de Resend, qui décide si un email part vraiment", async () => {
  const { identity } = await seedActor("owner")
  process.env.RESEND_API_KEY = "re_peu-importe"

  // Absente, la valeur sûre du composant s'applique : rien ne part.
  delete process.env.RESEND_TEST_MODE
  expect((await identity.query(api.settings.environment, {})).resend.testMode).toBe(true)

  // Seul `"false"` bascule en envoi réel — même lecture que `lib/resend.ts`.
  process.env.RESEND_TEST_MODE = "false"
  expect((await identity.query(api.settings.environment, {})).resend.testMode).toBe(false)

  process.env.RESEND_TEST_MODE = "no"
  expect((await identity.query(api.settings.environment, {})).resend.testMode).toBe(true)
})

test("environment rend les origines du site et du dashboard, qui ne sont pas des secrets", async () => {
  const { identity } = await seedActor("owner")
  process.env.SITE_URL = "https://admin.exemple.fr"
  process.env.WEB_SITE_URL = "https://exemple.fr"

  const state = await identity.query(api.settings.environment, {})
  expect(state.adminUrl).toBe("https://admin.exemple.fr")
  expect(state.webUrl).toBe("https://exemple.fr")
})

test("un editor peut lire l'état sans pouvoir rien changer", async () => {
  const { identity } = await seedActor("editor")
  // `getPrivate` lui rend déjà la ligne entière, secret du webhook compris :
  // lui refuser des booléens strictement moins sensibles n'aurait protégé
  // personne, et l'écran des réglages, qu'il a le droit de consulter,
  // n'aurait plus rien à afficher dans ses moitiés d'environnement.
  await expect(identity.query(api.settings.environment, {})).resolves.toBeTruthy()
})

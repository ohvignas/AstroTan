import { afterEach, beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import { ORIGIN, identityFor, makeTestConvex, seedUser, signIn } from "../testing/betterAuthFixture"

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
})

afterEach(() => {
  process.env = originalEnv
})

// `settings.get` n'a pas de contrôle de rôle et ne peut pas en avoir : le
// site public n'a ni session ni clé d'administration. Elle est donc lisible
// par quiconque connaît l'URL Convex, qui est dans le bundle du site.
//
// Ce fichier existe parce que ce n'a PAS toujours été vrai : la query
// rendait la ligne entière, et le jour où le secret de signature du webhook
// est entré dans cette table, il est devenu lisible par tout Internet.
test("la projection publique ne rend aucun secret", async () => {
  const t = makeTestConvex()
  const email = `settings-owner-${Date.now()}@example.com`
  const password = "correct horse battery staple settings"
  const user = await seedUser(t, { email, password, name: "Owner", role: "owner" })
  await signIn(t, email, password)
  const owner = await identityFor(t, user.id)

  await owner.mutation(api.settings.update, {
    siteName: "AstroTan",
    leadWebhookUrl: "https://hook.exemple.fr/leads",
    leadWebhookSecret: "le-secret-qui-signe-nos-appels",
  })

  // Sans session : exactement ce qu'un inconnu obtient.
  const publique = await t.query(api.settings.get, {})
  const champs = Object.keys(publique ?? {})

  expect(publique?.siteName).toBe("AstroTan")
  // Le test porte sur les CLÉS, pas sur les valeurs : un champ ajouté à la
  // table et recopié par inadvertance dans la projection échouerait ici,
  // même si sa valeur était vide au moment du test.
  //
  // Un SOUS-ENSEMBLE et non une égalité : Convex retire les champs
  // `undefined` avant l'envoi, donc un réglage facultatif non renseigné
  // n'apparaît pas du tout. Exiger la liste exacte ferait échouer ce test
  // sur une base neuve, pour une raison sans rapport avec ce qu'il garde.
  const AUTORISES = [
    "siteName",
    "logoId",
    "iconId",
    "homePageSlug",
    "defaultSeo",
    "socials",
    // Pas un secret : elle apparaît dans l'en-tête de chaque email envoyé.
    "emailFrom",
  ]
  const interdits = champs.filter((champ) => !AUTORISES.includes(champ))
  expect(interdits).toEqual([])
  expect(JSON.stringify(publique)).not.toContain("le-secret-qui-signe-nos-appels")
  expect(JSON.stringify(publique)).not.toContain("hook.exemple.fr")
})

test("la ligne entière exige une session", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.settings.getPrivate, {})).rejects.toThrow()
})

// La même fuite, du côté privé — et elle avait été refermée d'un seul côté.
//
// `getPrivate` rendait la LIGNE ENTIÈRE à un editor, `leadWebhookSecret`
// compris. L'écran `/settings/webhook` n'est gardé que par `canWrite`, qui
// grise le champ ; la valeur, elle, était bien dans la réponse. Avec ce
// secret et l'adresse du webhook, un editor forge un en-tête
// `x-astrotan-signature` valide et injecte de faux leads dans le scénario
// de l'opérateur.
test("getPrivate ne rend pas le secret du webhook, pas même à un owner", async () => {
  const t = makeTestConvex()
  const email = `settings-priv-${Date.now()}@example.com`
  const password = "correct horse battery staple settings priv"
  const user = await seedUser(t, { email, password, name: "Owner", role: "owner" })
  await signIn(t, email, password)
  const owner = await identityFor(t, user.id)

  await owner.mutation(api.settings.update, {
    siteName: "AstroTan",
    leadWebhookUrl: "https://hook.exemple.fr/leads",
    leadWebhookSecret: "sentinelle-hmac-a-ne-jamais-rendre",
  })

  const privee = await owner.query(api.settings.getPrivate, {})
  // L'adresse reste : elle n'est pas un secret, et l'écran l'affiche.
  expect(privee?.leadWebhookUrl).toBe("https://hook.exemple.fr/leads")
  expect(JSON.stringify(privee)).not.toContain("sentinelle-hmac-a-ne-jamais-rendre")
  // Le nom du champ autant que la valeur : le jour où quelqu'un le recopie
  // dans la projection, ce test le dit même si la valeur est vide.
  expect(Object.keys(privee ?? {})).not.toContain("leadWebhookSecret")

  // Il s'obtient par une demande explicite, réservée à owner/admin.
  expect(await owner.query(api.settings.webhookSecret, {})).toBe(
    "sentinelle-hmac-a-ne-jamais-rendre"
  )
})

test("un editor lit les réglages sans jamais voir le secret du webhook", async () => {
  const t = makeTestConvex()
  const password = "correct horse battery staple settings editor"
  const ownerEmail = `settings-o-${Date.now()}@example.com`
  const owner = await seedUser(t, {
    email: ownerEmail,
    password,
    name: "Owner",
    role: "owner",
  })
  await signIn(t, ownerEmail, password)
  const ownerIdentity = await identityFor(t, owner.id)
  await ownerIdentity.mutation(api.settings.update, {
    siteName: "AstroTan",
    leadWebhookUrl: "https://hook.exemple.fr/leads",
    leadWebhookSecret: "sentinelle-hmac-editor",
  })

  const editorEmail = `settings-e-${Date.now()}@example.com`
  const editor = await seedUser(t, {
    email: editorEmail,
    password,
    name: "Editor",
    role: "editor",
  })
  await signIn(t, editorEmail, password)
  const editorIdentity = await identityFor(t, editor.id)

  // Il garde ce dont l'écran a besoin…
  const vue = await editorIdentity.query(api.settings.getPrivate, {})
  expect(vue?.siteName).toBe("AstroTan")
  expect(JSON.stringify(vue)).not.toContain("sentinelle-hmac-editor")
  // …et la demande explicite lui est refusée.
  await expect(
    editorIdentity.query(api.settings.webhookSecret, {})
  ).rejects.toThrow(/FORBIDDEN/)
})

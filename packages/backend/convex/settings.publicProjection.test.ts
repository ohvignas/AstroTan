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
    // Relecture finale, correctif 1 : posée elle aussi, pour que le test
    // ci-dessous exerce vraiment le cas où elle a une valeur — plutôt que
    // de rester absent de la réponse pour la mauvaise raison (Convex
    // retire déjà les champs `undefined`).
    emailFrom: "AstroTan <bonjour@astrotan.exemple>",
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
  ]
  const interdits = champs.filter((champ) => !AUTORISES.includes(champ))
  expect(interdits).toEqual([])
  expect(JSON.stringify(publique)).not.toContain("le-secret-qui-signe-nos-appels")
  expect(JSON.stringify(publique)).not.toContain("hook.exemple.fr")
  // `emailFrom` N'EST PLUS ICI (relecture finale, correctif 1) : c'est
  // l'adresse d'expédition du site, sans consommateur dans `apps/web`
  // (`grep -rn "emailFrom" apps/` ne rend rien), posée dans la seule table
  // dont la projection publique a déjà coûté une fuite. `interdits` ci-
  // dessus l'attrape déjà si elle revient ; cette ligne l'affirme
  // explicitement, en visant sa VALEUR — pas seulement son nom de clé —
  // pour que ce test échoue même si `get` la renommait.
  expect(champs).not.toContain("emailFrom")
  expect(JSON.stringify(publique)).not.toContain("astrotan.exemple")
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

// Relecture finale, correctif 1 : `emailFrom` a quitté `get` (test du
// haut de ce fichier) pour `getPrivate`, réservée à owner/admin/editor —
// exactement comme `leadWebhookUrl` avant elle.
test("getPrivate rend l'adresse d'expédition, réservée à une session", async () => {
  const t = makeTestConvex()
  const email = `settings-emailfrom-${Date.now()}@example.com`
  const password = "correct horse battery staple emailfrom"
  const user = await seedUser(t, { email, password, name: "Owner", role: "owner" })
  await signIn(t, email, password)
  const owner = await identityFor(t, user.id)

  // Absente tant que personne ne l'a réglée : `null`, jamais `undefined`
  // silencieusement disparu — un écran futur doit pouvoir distinguer
  // « pas encore réglée » de « la requête a échoué ».
  await owner.mutation(api.settings.update, { siteName: "AstroTan" })
  expect((await owner.query(api.settings.getPrivate, {}))?.emailFrom).toBeNull()

  await owner.mutation(api.settings.update, {
    emailFrom: "AstroTan <bonjour@astrotan.exemple>",
  })
  const privee = await owner.query(api.settings.getPrivate, {})
  expect(privee?.emailFrom).toBe("AstroTan <bonjour@astrotan.exemple>")
})

// Correctif 1 : `settings.update` n'appelait pas `estAdresseValide` — une
// adresse malformée posée en CLI était acceptée en silence et ne se
// révélait qu'à l'envoi, où `choisirExpediteur` l'aurait de toute façon
// repliée sur le bac à sable sans que personne ne l'ait décidé.
test("une adresse d'expédition malformée est refusée à l'écriture, pas à l'envoi", async () => {
  const t = makeTestConvex()
  const email = `settings-emailfrom-invalide-${Date.now()}@example.com`
  const password = "correct horse battery staple emailfrom invalide"
  const user = await seedUser(t, { email, password, name: "Owner", role: "owner" })
  await signIn(t, email, password)
  const owner = await identityFor(t, user.id)

  await expect(
    owner.mutation(api.settings.update, { emailFrom: "pas-une-adresse" })
  ).rejects.toThrow(/INVALID_EMAIL_FROM/)

  // Rien n'a été écrit : la mutation a levé avant le patch.
  expect(await owner.query(api.settings.getPrivate, {})).toBeNull()

  // Les deux formes que Resend accepte passent toujours.
  await owner.mutation(api.settings.update, { emailFrom: "bonjour@astrotan.exemple" })
  await owner.mutation(api.settings.update, {
    emailFrom: "AstroTan <bonjour@astrotan.exemple>",
  })
  expect((await owner.query(api.settings.getPrivate, {}))?.emailFrom).toBe(
    "AstroTan <bonjour@astrotan.exemple>"
  )
})

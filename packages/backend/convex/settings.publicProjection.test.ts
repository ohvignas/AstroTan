import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import appSchema from "./schema"
import { ORIGIN, identityFor, makeTestConvex, seedUser, signIn } from "../testing/betterAuthFixture"

// Les champs autorisés dans la projection PUBLIQUE, en un seul endroit :
// les deux tests ci-dessous s'en servent, et deux copies auraient dérivé.
const AUTORISES = [
  "siteName",
  "logoId",
  "iconId",
  "homePageSlug",
  "defaultSeo",
  "socials",
]

// Les champs autorisés dans la projection du DASHBOARD. Les deux champs
// système en tête : `getPrivate` rend `_id` et `_creationTime`, que
// l'écran utilise, et qui ne sont pas dans le validateur de la table.
const AUTORISES_PRIVE = [
  "_id",
  "_creationTime",
  "siteName",
  "logoId",
  "iconId",
  "homePageSlug",
  "defaultSeo",
  "socials",
  "leadWebhookUrl",
  "leadWebhookLastStatus",
  "leadWebhookLastAt",
  "emailFrom",
]

// Toute la table, LUE DU SCHÉMA et non recopiée à la main — même motif que
// `_dataRegistry.test.ts`, qui dérive sa liste de `Object.keys(appSchema.tables)`
// pour la même raison : une liste recopiée reste vraie le jour où on l'écrit
// et fausse le lendemain, en silence.
const CHAMPS_DE_LA_TABLE = Object.keys(appSchema.tables.settings.validator.fields).sort()

// Une valeur non-`undefined` pour CHAQUE champ de la table.
//
// C'est le cœur de ce garde-fou, et la raison pour laquelle il est passé
// à côté de sa cible pendant un temps : Convex RETIRE les champs
// `undefined` avant l'envoi, donc un champ recopié par erreur dans une
// projection n'apparaît dans la réponse que s'il a une valeur en base.
// Une fixture qui ne posait que 4 des 11 champs laissait donc les sept
// autres entrer dans `settings.get` sans un seul test rouge — mesuré :
// ajouter `leadWebhookLastStatus` à la projection publique passait au
// vert. La ligne est semée par `ctx.db.insert` et non par
// `settings.update`, parce que la mutation n'expose pas
// `leadWebhookLastStatus` ni `leadWebhookLastAt` : les poser est
// justement ce qui manquait.
async function semerLaLigneEntiere(t: TestConvex<typeof appSchema>) {
  return t.run(async (ctx) => {
    const logoId = await ctx.storage.store(new Blob(["logo"]))
    const iconId = await ctx.storage.store(new Blob(["icone"]))
    const ligne = {
      siteName: "AstroTan",
      logoId,
      iconId,
      homePageSlug: "accueil",
      defaultSeo: { title: "Titre par défaut", description: "Description par défaut" },
      socials: [{ label: "Mastodon", url: "https://social.exemple/@astrotan" }],
      leadWebhookUrl: "https://hook.exemple.fr/leads",
      leadWebhookSecret: "sentinelle-secret-de-signature",
      leadWebhookLastStatus: "sentinelle-dernier-statut",
      leadWebhookLastAt: 1_700_000_000_000,
      emailFrom: "AstroTan <bonjour@astrotan.exemple>",
    }
    await ctx.db.insert("settings", ligne)
    return ligne
  })
}

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
  // Un SOUS-ENSEMBLE et non une égalité : `settings.update` ne pose que
  // ce que ce test lui soumet, Convex retire les champs `undefined` avant
  // l'envoi, et exiger la liste exacte ferait donc échouer ce test-ci pour
  // une raison sans rapport avec ce qu'il garde.
  //
  // C'est aussi sa LIMITE, et elle a été mesurée : ce test ne voit que les
  // champs qu'il a lui-même semés. Les sept autres champs de la table
  // pouvaient entrer dans la projection publique sans le faire rougir.
  // C'est le dernier test du fichier qui ferme ce trou, en semant la ligne
  // ENTIÈRE et en exigeant l'égalité ; celui-ci garde ce qu'il sait bien
  // garder — le chemin d'écriture réel, par la mutation, avec des valeurs
  // sentinelles.
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

// ---------------------------------------------------------------------
// Le garde-fou TOTAL : toute la table, pas seulement ce qu'un test a semé.
//
// Les tests ci-dessus passent par `settings.update`, donc ne posent que
// les champs que la mutation accepte et qu'ils lui soumettent. Convex
// retirant les champs `undefined`, un champ recopié par erreur dans une
// projection restait alors INVISIBLE dans la réponse — et le garde-fou
// vert. Mesuré, pas supposé : ajouter `leadWebhookLastStatus` à
// `settings.get` laissait les six tests précédents au vert.
//
// Les trois tests qui suivent sèment la ligne ENTIÈRE : le premier
// vérifie qu'elle couvre bien toute la table — sans quoi les deux autres
// sont aveugles pour la même raison —, les deux autres exigent
// l'ÉGALITÉ. Ce qu'ils ferment est la CLASSE, pas l'instance : le
// prochain champ sensible ajouté à `settings` — une clé d'API, un jeton,
// une adresse — n'entrera dans aucune des deux projections sans faire
// rougir la suite, sans que personne n'ait à penser à revenir ici.
// ---------------------------------------------------------------------

// La condition de validité des deux tests suivants, énoncée à part parce
// qu'elle est la seule chose qui puisse les rendre aveugles à nouveau :
// une ligne qui ne couvre pas toute la table les ramène exactement au
// défaut qu'ils corrigent. Elle est vérifiée contre le SCHÉMA, donc un
// douzième champ ajouté à `settings` fait échouer ce test tant qu'il
// n'est pas semé — et le fait échouer ICI, avec ce message, plutôt que
// dans une assertion d'égalité qui ne dirait pas pourquoi.
test("la ligne semée couvre toute la table — sans quoi les deux tests suivants sont aveugles", async () => {
  const t = makeTestConvex()
  const ligne = await semerLaLigneEntiere(t)
  expect(
    Object.keys(ligne).sort(),
    "Un champ a été ajouté à la table `settings` sans être semé dans " +
      "`semerLaLigneEntiere` (convex/settings.publicProjection.test.ts). " +
      "Donnez-lui une valeur non-`undefined` : Convex retire les champs " +
      "`undefined` avant l'envoi, donc un champ non semé peut entrer dans " +
      "`settings.get` — publique et non authentifiée — sans qu'aucun test " +
      "ne rougisse. C'est exactement la fuite que `leadWebhookSecret` a " +
      "déjà coûtée à cette table.",
  ).toEqual(CHAMPS_DE_LA_TABLE)
})

test("aucun champ de la table n'entre dans la projection publique sans être autorisé", async () => {
  const t = makeTestConvex()
  await semerLaLigneEntiere(t)

  // Sans session : exactement ce qu'un inconnu obtient.
  const publique = await t.query(api.settings.get, {})

  // Une ÉGALITÉ, possible ici et seulement ici parce que les onze champs
  // ont une valeur : aucun n'est absent pour la mauvaise raison.
  expect(
    Object.keys(publique ?? {}).sort(),
    "`settings.get` est publique et non authentifiée : ce qu'elle rend est " +
      "lisible par quiconque connaît l'URL Convex, qui est dans le bundle du " +
      "site. Un champ de plus dans cette réponse est une fuite, un champ de " +
      "moins casse le site public.",
  ).toEqual([...AUTORISES].sort())

  // Les valeurs, en plus des noms : la projection échouerait aussi si elle
  // rendait un secret sous un autre nom de clé.
  const rendu = JSON.stringify(publique)
  expect(rendu).not.toContain("sentinelle-secret-de-signature")
  expect(rendu).not.toContain("sentinelle-dernier-statut")
  expect(rendu).not.toContain("hook.exemple.fr")
  expect(rendu).not.toContain("astrotan.exemple")
})

// La même totalité côté dashboard. Le rôle y limite déjà les dégâts —
// owner, admin, editor —, mais c'est la projection qui a réellement fui
// `leadWebhookSecret` à un editor, et rien n'énumérait la table de ce
// côté-là non plus.
test("aucun champ de la table n'entre dans la projection du dashboard sans être autorisé", async () => {
  const t = makeTestConvex()
  const email = `settings-total-${Date.now()}@example.com`
  const password = "correct horse battery staple settings total"
  const user = await seedUser(t, { email, password, name: "Owner", role: "owner" })
  await signIn(t, email, password)
  const owner = await identityFor(t, user.id)
  await semerLaLigneEntiere(t)

  const privee = await owner.query(api.settings.getPrivate, {})
  expect(
    Object.keys(privee ?? {}).sort(),
    "`settings.getPrivate` est lue par un editor. Le secret de signature " +
      "du webhook y a déjà été rendu une fois : avec lui et " +
      "`leadWebhookUrl`, un editor forge des appels signés vers le scénario " +
      "de l'opérateur. Un jeton ajouté à cette table ne s'y invite pas.",
  ).toEqual([...AUTORISES_PRIVE].sort())

  expect(JSON.stringify(privee)).not.toContain("sentinelle-secret-de-signature")
})

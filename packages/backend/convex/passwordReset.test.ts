import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { Resend } from "@convex-dev/resend"
import { components } from "./_generated/api"
import { createAuth } from "./auth"
import { CATALOGUE } from "./lib/catalogueEmails"
import { ORIGIN, makeTestConvex, seedUser, signIn } from "../testing/betterAuthFixture"

// ---------------------------------------------------------------------
// La récupération de mot de passe : le seul chemin de retour dans un
// déploiement où l'inscription est fermée.
//
// Ce fichier garde trois choses que Better Auth ne garde PAS tout seul,
// chacune étant un défaut de sa configuration par défaut :
//
//   1. `revokeSessionsOnPasswordReset` vaut `false` par défaut. La raison
//      la plus fréquente de réinitialiser est le soupçon d'un vol : ne pas
//      révoquer laisse précisément le voleur connecté.
//   2. Rien dans `/request-password-reset` ne consulte `banned` (vérifié
//      dans `better-auth@1.6.17`'s `api/routes/password.mjs` : la route
//      ne lit que `findUserByEmail`). Un compte suspendu pouvait donc se
//      réinitialiser et revenir.
//   3. Le refus doit être INDISTINGUABLE de « cette adresse n'existe
//      pas ». Une réponse différente ferait de l'écran un oracle
//      distinguant « suspendu » de « inconnu ».
//
// Le tout se conduit par HTTP (`t.fetch("/api/auth/...")`) et non par
// `auth.api.*` : c'est le chemin qu'un navigateur emprunte réellement, et
// c'est le seul qui exerce `hooks.before`, le routeur et le corps de
// réponse — les trois endroits où un oracle peut apparaître.
// ---------------------------------------------------------------------

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
})

afterEach(() => {
  process.env = originalEnv
  vi.restoreAllMocks()
})

type EnvoiCapture = {
  to: string | string[]
  subject: string
  html?: string
  text?: string
}

/**
 * Espionne l'envoi au niveau du prototype, et non d'une instance : le
 * client Resend est construit à l'appel (`lib/resend.ts`), donc il n'existe
 * aucune instance à intercepter avant que l'action ne tourne.
 */
function capturerLesEnvois(): EnvoiCapture[] {
  const envoyes: EnvoiCapture[] = []
  vi.spyOn(Resend.prototype, "sendEmail").mockImplementation((async (
    _ctx: unknown,
    options: EnvoiCapture,
  ) => {
    envoyes.push(options)
    return "email-de-test"
  }) as unknown as Resend["sendEmail"])
  return envoyes
}

// Même raison que dans `invitations.test.ts` :
// `finishInProgressScheduledFunctions` ne draine que les jobs déjà passés
// en « inProgress », et un `runAfter(0, …)` vers une *action* peut encore
// être « pending » à cet instant.
async function runScheduledFunctions(t: ReturnType<typeof makeTestConvex>) {
  vi.useFakeTimers()
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers)
  } finally {
    vi.useRealTimers()
  }
}

const MOT_DE_PASSE = "correct horse battery staple 1"

async function seedActeur(
  t: ReturnType<typeof makeTestConvex>,
  email: string,
  options: { banned?: boolean } = {},
) {
  const user = await seedUser(t, {
    email,
    password: MOT_DE_PASSE,
    name: "Quelqu'un",
    role: "editor",
  })
  if (options.banned) {
    // Écrit directement dans la table du composant : le chemin du ban
    // (`auth.api.banUser`, ses permissions, sa frontière de rôles) n'est
    // pas le sujet ici — l'ÉTAT « suspendu » l'est.
    await t.run(async (ctx) =>
      ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: "user",
          where: [{ field: "email", operator: "eq", value: email }],
          update: { banned: true },
        },
      }),
    )
  }
  return user
}

/** Ce qu'un navigateur reçoit : le code HTTP et le corps, rien d'autre. */
async function demanderReinitialisation(t: ReturnType<typeof makeTestConvex>, email: string) {
  const res = await t.fetch("/api/auth/request-password-reset", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email }),
  })
  return { status: res.status, body: await res.text() }
}

/** Le jeton tel qu'il arrive réellement à la personne : extrait du lien. */
function jetonDuLien(texte: string | undefined): string {
  const trouve = /\/reset-password\?token=([^\s"<]+)/.exec(texte ?? "")
  if (!trouve?.[1]) throw new Error("aucun lien de réinitialisation dans l'email")
  return decodeURIComponent(trouve[1])
}

async function reinitialiser(
  t: ReturnType<typeof makeTestConvex>,
  token: string,
  nouveauMotDePasse: string,
) {
  return t.fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ token, newPassword: nouveauMotDePasse }),
  })
}

/** Le parcours complet, du formulaire au jeton en main. */
async function obtenirUnJeton(t: ReturnType<typeof makeTestConvex>, email: string) {
  const envois = capturerLesEnvois()
  await demanderReinitialisation(t, email)
  await runScheduledFunctions(t)
  expect(envois).toHaveLength(1)
  return jetonDuLien(envois[0]!.text)
}

// --- Le silence, qui est la fonctionnalité --------------------------------

test("une demande pour une adresse inconnue ne lève pas et n'envoie rien", async () => {
  // Le silence est la fonctionnalité : une erreur, ou une absence
  // d'erreur, dirait à qui la provoque si l'adresse a un compte.
  const t = makeTestConvex()
  const envois = capturerLesEnvois()

  const reponse = await demanderReinitialisation(t, "personne@exemple.fr")
  await runScheduledFunctions(t)

  expect(reponse.status).toBe(200)
  expect(envois).toHaveLength(0)
})

test("une demande pour un compte suspendu n'envoie rien, et ne le dit pas", async () => {
  const t = makeTestConvex()
  await seedActeur(t, "suspendu@exemple.fr", { banned: true })
  const envois = capturerLesEnvois()

  const reponse = await demanderReinitialisation(t, "suspendu@exemple.fr")
  await runScheduledFunctions(t)

  expect(envois).toHaveLength(0)
  // La même réponse que pour une adresse inconnue, au code HTTP et au
  // corps près : sinon l'écran devient un oracle qui distingue
  // « suspendu » de « inexistant ».
  expect(reponse).toEqual(await demanderReinitialisation(t, "personne@exemple.fr"))
})

test("un ban EXPIRÉ ne bloque plus la réinitialisation", async () => {
  // `isCurrentlyBanned` (lib/authz.ts) est la seule définition de
  // « suspendu » du dépôt, et elle traite un `banExpires` déjà passé comme
  // un ban levé — c'est aussi ce que fait le plugin admin à la connexion.
  // Refuser ici enfermerait quelqu'un dont la sanction est terminée.
  const t = makeTestConvex()
  await seedActeur(t, "ban-fini@exemple.fr", { banned: true })
  await t.run(async (ctx) =>
    ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: "user",
        where: [{ field: "email", operator: "eq", value: "ban-fini@exemple.fr" }],
        update: { banExpires: Date.now() - 60_000 },
      },
    }),
  )
  const envois = capturerLesEnvois()

  await demanderReinitialisation(t, "ban-fini@exemple.fr")
  await runScheduledFunctions(t)

  expect(envois).toHaveLength(1)
})

// --- L'envoi lui-même -----------------------------------------------------

test("une demande pour un compte actif envoie le lien", async () => {
  const t = makeTestConvex()
  await seedActeur(t, "actif@exemple.fr")
  const envois = capturerLesEnvois()

  await demanderReinitialisation(t, "actif@exemple.fr")
  await runScheduledFunctions(t)

  expect(envois).toHaveLength(1)
  expect(envois[0]!.to).toBe("actif@exemple.fr")
  // Le lien est la raison d'être de cet email : il doit survivre dans les
  // deux corps, sinon l'email n'ouvre plus aucune porte.
  expect(envois[0]!.text).toContain("/reset-password?token=")
  expect(envois[0]!.html).toContain("/reset-password?token=")
})

test("le texte part du catalogue quand personne n'y a touché", async () => {
  const t = makeTestConvex()
  await seedActeur(t, "actif@exemple.fr")
  const envois = capturerLesEnvois()

  await demanderReinitialisation(t, "actif@exemple.fr")
  await runScheduledFunctions(t)

  const description = CATALOGUE.find((email) => email.cle === "passwordReset")!
  expect(envois[0]!.subject).toBe(description.objetParDefaut)
})

test("un gabarit personnalisé remplace le texte, lien compris", async () => {
  // Le même chemin que l'invitation : l'écran « envoi des emails » décide
  // ce qui part, sans quoi ce réglage serait décoratif.
  const t = makeTestConvex()
  await seedActeur(t, "actif@exemple.fr")
  await t.run(async (ctx) => {
    await ctx.db.insert("emailTemplates", {
      cle: "passwordReset",
      objet: "Reprenez la main",
      corps: "Choisissez un nouveau mot de passe : {{lien}}",
      actif: true,
      majPar: "un-identifiant-better-auth",
      majAt: Date.now(),
    })
  })
  const envois = capturerLesEnvois()

  await demanderReinitialisation(t, "actif@exemple.fr")
  await runScheduledFunctions(t)

  expect(envois[0]!.subject).toBe("Reprenez la main")
  expect(envois[0]!.text).toContain("/reset-password?token=")
})

test("le jeton envoyé réinitialise réellement le mot de passe", async () => {
  const t = makeTestConvex()
  await seedActeur(t, "actif@exemple.fr")

  const token = await obtenirUnJeton(t, "actif@exemple.fr")
  const res = await reinitialiser(t, token, "un-nouveau-mot-de-passe")
  expect(res.status).toBe(200)

  // La preuve que ce n'est pas seulement un 200 poli : l'ancien mot de
  // passe ne fonctionne plus, le nouveau si.
  await expect(signIn(t, "actif@exemple.fr", MOT_DE_PASSE)).rejects.toThrow()
  await expect(signIn(t, "actif@exemple.fr", "un-nouveau-mot-de-passe")).resolves.toBeTruthy()
})

// --- Les trois défauts par défaut -----------------------------------------

test("réinitialiser révoque les autres sessions", async () => {
  // `revokeSessionsOnPasswordReset` vaut FAUX par défaut chez Better Auth.
  // Sans cette option, quelqu'un qui réinitialise parce qu'il soupçonne un
  // vol laisse le voleur connecté — exactement l'inverse de son intention.
  const t = makeTestConvex()
  await seedActeur(t, "actif@exemple.fr")
  const ancienneSession = await signIn(t, "actif@exemple.fr", MOT_DE_PASSE)

  const avant = await t.fetch("/api/auth/get-session", {
    headers: { cookie: ancienneSession, origin: ORIGIN },
  })
  expect(await avant.text()).toContain("actif@exemple.fr")

  const token = await obtenirUnJeton(t, "actif@exemple.fr")
  await reinitialiser(t, token, "un-nouveau-mot-de-passe")

  const apres = await t.fetch("/api/auth/get-session", {
    headers: { cookie: ancienneSession, origin: ORIGIN },
  })
  expect(await apres.text()).not.toContain("actif@exemple.fr")
})

test("le jeton n'est jamais stocké en clair dans la table `verification`", async () => {
  // `verification.storeIdentifier` vaut « plain » par défaut (vérifié dans
  // `better-auth@1.6.17`'s `db/verification-token-storage.mjs`) : la table
  // porterait alors `reset-password:<jeton>` en clair, c'est-à-dire un
  // accès administrateur utilisable, lisible par quiconque exporte la
  // base. `invitations` ne stocke déjà que l'empreinte de son jeton ; il
  // n'y a aucune raison que celui-ci soit moins bien traité.
  const t = makeTestConvex()
  await seedActeur(t, "actif@exemple.fr")

  const token = await obtenirUnJeton(t, "actif@exemple.fr")

  const lignes = await t.run(async (ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "verification",
      paginationOpts: { numItems: 50, cursor: null },
    }),
  )
  expect(lignes.page.length).toBeGreaterThan(0)
  for (const ligne of lignes.page) {
    expect(String(ligne.identifier)).not.toContain(token)
  }

  // Et le jeton fonctionne quand même : l'empreinte est transparente pour
  // l'appelant, pas un changement de protocole.
  expect((await reinitialiser(t, token, "un-nouveau-mot-de-passe")).status).toBe(200)
})

test("la durée de vie du jeton est posée explicitement, jamais héritée", async () => {
  // Better Auth retombe sur `3600 * 1` secondes quand l'option est absente
  // (`api/routes/password.mjs`). L'écrire ici fait de cette valeur une
  // décision de ce dépôt : `/confidentialite` publie cette durée comme
  // celle de conservation de la table `verification`, et une valeur
  // héritée pourrait changer au prochain `pnpm update` sans que la page
  // publiée ne bouge.
  const t = makeTestConvex()
  const duree = await t.run(async (ctx) => {
    const options = createAuth(ctx).options as {
      emailAndPassword?: { resetPasswordTokenExpiresIn?: number }
    }
    return options.emailAndPassword?.resetPasswordTokenExpiresIn
  })
  expect(duree).toBe(60 * 60)
})

// --- Le journal -----------------------------------------------------------

test("une réinitialisation laisse une ligne au journal d'audit", async () => {
  const t = makeTestConvex()
  await seedActeur(t, "actif@exemple.fr")

  const token = await obtenirUnJeton(t, "actif@exemple.fr")
  await reinitialiser(t, token, "un-nouveau-mot-de-passe")

  const journal = await t.run(async (ctx) => ctx.db.query("auditLog").collect())
  expect(journal).toHaveLength(1)
  expect(journal[0]!.action).toBe("password.reset")
  expect(journal[0]!.cible).toBe("actif@exemple.fr")
  // Jamais le jeton, jamais le mot de passe.
  const serialise = JSON.stringify(journal[0])
  expect(serialise).not.toContain("un-nouveau-mot-de-passe")
  expect(serialise).not.toContain(token)
})

test("une demande qui n'aboutit jamais ne journalise rien", async () => {
  // Le journal dit qu'un mot de passe A CHANGÉ, pas qu'on a demandé à le
  // changer : `/request-password-reset` est ouvert à Internet, et
  // journaliser à ce stade laisserait n'importe qui remplir le journal
  // — et y écrire des adresses qui n'ont pas de compte.
  const t = makeTestConvex()
  await seedActeur(t, "actif@exemple.fr")

  await demanderReinitialisation(t, "actif@exemple.fr")
  await demanderReinitialisation(t, "personne@exemple.fr")
  await runScheduledFunctions(t)

  const journal = await t.run(async (ctx) => ctx.db.query("auditLog").collect())
  expect(journal).toEqual([])
})

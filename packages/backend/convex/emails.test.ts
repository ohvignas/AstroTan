import { afterEach, beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import { gabaritPour } from "./emails"
import { CATALOGUE } from "./lib/catalogueEmails"
import { ORIGIN, identityFor, makeTestConvex, seedUser, signIn } from "../testing/betterAuthFixture"

// ---------------------------------------------------------------------
// L'écran d'envoi des emails, côté backend.
//
// Ce fichier garde trois frontières, et aucune ne recouvre les autres :
//
//   1. **Le repli vers le code est le cas NORMAL.** Un déploiement neuf
//      n'a aucune ligne dans `emailTemplates`, et doit pourtant savoir
//      exactement quel texte part — et le dire à l'écran sans deviner.
//   2. **Refusé à l'écriture, jamais bloquant à la lecture.** Deux
//      exigences distinctes : un gabarit invalide n'est pas écrit ; un
//      gabarit DEVENU invalide n'arrête pas un envoi. La seconde n'est
//      pas hypothétique — le catalogue peut gagner une variable
//      obligatoire, et les gabarits d'avant ne l'ont pas.
//   3. **L'invitation ne se coupe pas, et c'est le serveur qui le dit.**
//      Un bouton grisé n'est pas une décision (invariant 3 de
//      `CLAUDE.md`).
//
// Le quatrième test du brief — « la notification coupée, alors rien ne
// part » — n'est PAS ici : il exige que `leads.notifyStaff` consulte
// `gabaritPour`, ce que la tâche suivante branche. L'écrire ici le ferait
// échouer pour la bonne raison au mauvais moment ; ce que cette tâche peut
// prouver, c'est que la décision est lisible et juste (`actif` faux), et
// c'est ce que fait `gabaritPour` ci-dessous.
// ---------------------------------------------------------------------

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
})

afterEach(() => {
  process.env = originalEnv
})

async function seedActor(
  t: ReturnType<typeof makeTestConvex>,
  role: "owner" | "admin" | "editor",
) {
  const email = `emails-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple emails"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { user, identity: await identityFor(t, user.id) }
}

const INVITATION = CATALOGUE.find((email) => email.cle === "invitation")!
const LEAD = CATALOGUE.find((email) => email.cle === "leadNotification")!

// --- Le repli vers le code -------------------------------------------

test("sans ligne en base, le gabarit est celui du code", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "owner")

  const liste = await identity.query(api.emails.list, {})
  expect(liste).toHaveLength(CATALOGUE.length)

  const invitation = liste.find((e) => e.cle === "invitation")!
  expect(invitation.objet).toBe(INVITATION.objetParDefaut)
  expect(invitation.corps).toBe(INVITATION.corpsParDefaut)
  // Ce que l'écran doit pouvoir dire sans deviner.
  expect(invitation.personnalise).toBe(false)
  expect(invitation.enregistre).toBeNull()
  expect(invitation.actif).toBe(true)
})

test("le même repli vaut pour le point de lecture des envois", async () => {
  // `list` sert l'écran ; `gabaritPour` sert les envois. Vérifier l'un ne
  // dit rien de l'autre — et c'est le second qui décide de ce qui part.
  const t = makeTestConvex()
  const gabarit = await t.run((ctx) => gabaritPour(ctx, "invitation"))
  expect(gabarit).toEqual({
    objet: INVITATION.objetParDefaut,
    corps: INVITATION.corpsParDefaut,
    actif: true,
    personnalise: false,
    probleme: null,
  })
})

test("un texte enregistré remplace celui du code, et l'écran le dit", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "owner")

  await identity.mutation(api.emails.setTemplate, {
    cle: "leadNotification",
    objet: "Un message de {{nom}}",
    corps: "{{message}}",
  })

  const ligne = (await identity.query(api.emails.list, {})).find(
    (e) => e.cle === "leadNotification",
  )!
  expect(ligne.objet).toBe("Un message de {{nom}}")
  expect(ligne.personnalise).toBe(true)
  expect(ligne.probleme).toBeNull()
  // Le nom de l'auteur, pas son identifiant : l'écran affiche « modifié
  // par », et un identifiant Better Auth ne dit rien à personne.
  expect(ligne.majParNom).toBe("Actor owner")
  expect(ligne.majAt).toBeGreaterThan(0)
})

test("rétablir le défaut efface le texte, et l'écran repasse à « par défaut »", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "owner")

  await identity.mutation(api.emails.setTemplate, {
    cle: "leadNotification",
    objet: "Un message de {{nom}}",
    corps: "{{message}}",
  })
  await identity.mutation(api.emails.resetTemplate, { cle: "leadNotification" })

  const ligne = (await identity.query(api.emails.list, {})).find(
    (e) => e.cle === "leadNotification",
  )!
  expect(ligne.objet).toBe(LEAD.objetParDefaut)
  expect(ligne.personnalise).toBe(false)
  expect(ligne.enregistre).toBeNull()
})

test("rétablir le texte ne rallume pas un envoi qu'on avait coupé", async () => {
  // Deux décisions distinctes, et les enchaîner en silence ferait repartir
  // des emails que personne n'a redemandés.
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "owner")

  await identity.mutation(api.emails.setTemplate, {
    cle: "leadNotification",
    objet: "Un message de {{nom}}",
    corps: "{{message}}",
  })
  await identity.mutation(api.emails.setActif, { cle: "leadNotification", actif: false })
  await identity.mutation(api.emails.resetTemplate, { cle: "leadNotification" })

  const ligne = (await identity.query(api.emails.list, {})).find(
    (e) => e.cle === "leadNotification",
  )!
  expect(ligne.personnalise).toBe(false)
  expect(ligne.actif).toBe(false)
})

// --- Refusé à l'écriture ---------------------------------------------

test("un gabarit refusé n'est jamais écrit", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "owner")

  await expect(
    identity.mutation(api.emails.setTemplate, {
      cle: "invitation",
      objet: "Bonjour",
      corps: "sans lien",
    }),
  ).rejects.toThrow()

  const invitation = (await identity.query(api.emails.list, {})).find(
    (e) => e.cle === "invitation",
  )!
  expect(invitation.personnalise).toBe(false)
  expect(invitation.enregistre).toBeNull()
  expect(invitation.corps).toBe(INVITATION.corpsParDefaut)
})

test("le refus porte la phrase à afficher, pas seulement un code", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "owner")

  await expect(
    identity.mutation(api.emails.setTemplate, {
      cle: "leadNotification",
      objet: "Nouveau message de {{prenom}}",
      corps: "{{message}}",
    }),
  ).rejects.toThrow(/prenom/)
})

// --- Jamais bloquant à la lecture ------------------------------------

test("un gabarit devenu invalide n'arrête pas l'envoi : c'est le défaut qui part", async () => {
  // Le scénario réel : une version ultérieure du catalogue ajoute une
  // variable obligatoire, et les gabarits enregistrés avant ne l'ont pas.
  // On l'imite en écrivant la ligne directement, comme la version d'hier
  // l'aurait fait — `setTemplate` refuserait aujourd'hui, et c'est
  // précisément le point.
  const t = makeTestConvex()
  const { identity, user } = await seedActor(t, "owner")
  await t.run(async (ctx) => {
    await ctx.db.insert("emailTemplates", {
      cle: "invitation",
      objet: "Bienvenue",
      corps: "Sans le moindre lien.",
      actif: true,
      majPar: user.id,
      majAt: Date.now(),
    })
  })

  const gabarit = await t.run((ctx) => gabaritPour(ctx, "invitation"))
  expect(gabarit.corps).toBe(INVITATION.corpsParDefaut)
  expect(gabarit.personnalise).toBe(false)
  expect(gabarit.probleme).toContain("{{lien}}")

  // Et l'écran montre le texte écarté, sinon la personne à qui on demande
  // de le réparer ne le voit nulle part.
  const ligne = (await identity.query(api.emails.list, {})).find((e) => e.cle === "invitation")!
  expect(ligne.probleme).toContain("{{lien}}")
  expect(ligne.enregistre).toEqual({ objet: "Bienvenue", corps: "Sans le moindre lien." })
  expect(ligne.corps).toBe(INVITATION.corpsParDefaut)
})

// --- L'invitation ne se coupe pas ------------------------------------

test("l'invitation ne peut pas être coupée", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "owner")

  await expect(
    identity.mutation(api.emails.setActif, { cle: "invitation", actif: false }),
  ).rejects.toThrow(/EMAIL_NON_DESACTIVABLE/)

  // Rien n'a été écrit : le refus est un refus, pas une écriture rattrapée.
  const invitation = (await identity.query(api.emails.list, {})).find(
    (e) => e.cle === "invitation",
  )!
  expect(invitation.actif).toBe(true)
  expect(invitation.majAt).toBeNull()
})

test("même une ligne arrivée par un autre chemin ne coupe pas l'invitation", async () => {
  // Seconde barrière : une restauration de sauvegarde, un `convex import`,
  // ou une version du catalogue où l'email était encore désactivable. La
  // mutation n'est pas le seul chemin vers la table — le point de lecture,
  // lui, est le seul chemin vers un envoi.
  const t = makeTestConvex()
  const { user } = await seedActor(t, "owner")
  await t.run(async (ctx) => {
    await ctx.db.insert("emailTemplates", {
      cle: "invitation",
      actif: false,
      majPar: user.id,
      majAt: Date.now(),
    })
  })

  const gabarit = await t.run((ctx) => gabaritPour(ctx, "invitation"))
  expect(gabarit.actif).toBe(true)
})

test("la notification de lead, elle, se coupe — et la décision se lit", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "owner")

  await identity.mutation(api.emails.setActif, { cle: "leadNotification", actif: false })

  const gabarit = await t.run((ctx) => gabaritPour(ctx, "leadNotification"))
  expect(gabarit.actif).toBe(false)
  // Couper l'interrupteur ne touche pas au texte : la ligne ne porte que
  // la décision, et le texte reste celui du code.
  expect(gabarit.personnalise).toBe(false)
  expect(gabarit.corps).toBe(LEAD.corpsParDefaut)
})

// --- Le journal -------------------------------------------------------

test("modifier un gabarit laisse une ligne au journal d'audit, sans le texte", async () => {
  // Le journal dit QUI a changé QUOI, jamais le contenu : un gabarit peut
  // contenir la signature de l'entreprise, et `auditLog` n'est balayée par
  // aucune purge de `retention.ts`.
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "owner")

  await identity.mutation(api.emails.setTemplate, {
    cle: "leadNotification",
    // Un objet volontairement reconnaissable, et qui ne recoupe aucun
    // libellé du catalogue : « Nouveau message » aurait été un faux
    // positif, le titre de cet email l'ayant déjà dans son nom.
    objet: "Signature confidentielle SARL Exemple",
    corps: "{{message}}",
  })

  const journal = await identity.query(api.auditLog.list, {})
  expect(journal[0]!.action).toBe("emailTemplate.set")
  expect(journal[0]!.phrase).toContain(LEAD.titre)
  expect(JSON.stringify(journal[0])).not.toContain("{{message}}")
  expect(JSON.stringify(journal[0])).not.toContain("Signature confidentielle")
})

test("couper et rétablir un envoi se relisent différemment dans le journal", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "owner")

  await identity.mutation(api.emails.setActif, { cle: "leadNotification", actif: false })
  await identity.mutation(api.emails.resetTemplate, { cle: "leadNotification" })
  await identity.mutation(api.emails.setActif, { cle: "leadNotification", actif: true })

  const journal = await identity.query(api.auditLog.list, {})
  // `resetTemplate` n'avait rien à rétablir : aucune ligne, parce qu'un
  // journal qui raconte un geste sans effet est faux, pas généreux.
  expect(journal.map((l) => l.action)).toEqual(["emailTemplate.toggle", "emailTemplate.toggle"])
  expect(journal[0]!.phrase).toContain("réactivé")
  expect(journal[1]!.phrase).toContain("désactivé")
})

// --- Les rôles --------------------------------------------------------

test("un editor ne voit ni ne modifie les gabarits", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "editor")

  await expect(identity.query(api.emails.list, {})).rejects.toThrow(/FORBIDDEN/)
  await expect(
    identity.mutation(api.emails.setTemplate, {
      cle: "leadNotification",
      objet: "Bonjour",
      corps: "Bonjour",
    }),
  ).rejects.toThrow(/FORBIDDEN/)
  await expect(
    identity.mutation(api.emails.setActif, { cle: "leadNotification", actif: false }),
  ).rejects.toThrow(/FORBIDDEN/)
  await expect(
    identity.mutation(api.emails.resetTemplate, { cle: "leadNotification" }),
  ).rejects.toThrow(/FORBIDDEN/)
})

test("sans session, on ne lit ni n'écrit rien", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.emails.list, {})).rejects.toThrow()
  await expect(
    t.mutation(api.emails.setTemplate, {
      cle: "leadNotification",
      objet: "Bonjour",
      corps: "Bonjour",
    }),
  ).rejects.toThrow()
})

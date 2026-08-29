import type { TestConvex } from "convex-test"
import { afterEach, beforeEach, expect, test } from "vitest"
import schema from "./schema"
import { api } from "./_generated/api"
import { SECRETS_KEY_VAR } from "./lib/secretsCrypto"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

// ---------------------------------------------------------------------
// Le journal des gestes sensibles, point d'écriture par point d'écriture.
//
// Un point d'écriture journalisé SANS test est une ligne de journal dont
// personne ne sait si elle part : le geste réussit, l'écran ne montre
// rien, et le manque ne se découvre qu'au moment où l'on relit le journal
// pour comprendre un incident — trop tard, par construction. D'où un test
// par geste, chacun affirmant les mêmes trois choses : la ligne existe,
// elle porte la bonne action, elle nomme le bon acteur.
//
// Deux tests vont plus loin que ça, et ce sont les deux qui comptent :
//
//   • `secrets.set` — la valeur du jeton ne doit apparaître NULLE PART
//     dans le journal, même tronquée. Une sentinelle est écrite, et le
//     JSON de toute la table doit ne pas la contenir.
//   • `leads.remove` — l'adresse de la personne effacée ne doit pas plus
//     y apparaître. Le journal survivrait à l'effacement que
//     `dataSubject.ts` promet, et le défairait.
// ---------------------------------------------------------------------

let originalEnv: NodeJS.ProcessEnv

/** 32 octets en base64, comme la commande de l'écran des jetons en produit. */
const CLE_MAITRESSE = btoa(
  String.fromCharCode(...new Uint8Array(32).map((_, i) => (i * 7 + 13) % 251)),
)

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env[SECRETS_KEY_VAR] = CLE_MAITRESSE
  // Sinon la précédence de `secrets.ts` fait gagner l'environnement et le
  // test ne mesurerait plus l'écriture qu'il croit mesurer.
  delete process.env.OPENROUTER_API_KEY
})

afterEach(() => {
  process.env = originalEnv
})

const NOM_ACTEUR = "Antoine Journal"

async function seedActor(
  t: TestConvex<typeof schema>,
  role: "owner" | "admin" | "editor" = "owner",
) {
  const email = `audit-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple audit"
  const user = await seedUser(t, { email, password, name: NOM_ACTEUR, role })
  await signIn(t, email, password)
  return { identity: await identityFor(t, user.id), id: user.id, email }
}

async function seedCible(t: TestConvex<typeof schema>) {
  const email = `audit-cible-${Date.now()}-${Math.random()}@example.com`
  const user = await seedUser(t, {
    email,
    password: "correct horse battery staple cible",
    name: "Cible",
    role: "editor",
  })
  return { id: user.id, email }
}

async function lignes(t: TestConvex<typeof schema>) {
  return t.run((ctx) => ctx.db.query("auditLog").collect())
}

/** La seule ligne du journal — et le fait qu'il n'y en ait qu'une. */
async function ligneUnique(t: TestConvex<typeof schema>) {
  const toutes = await lignes(t)
  expect(toutes).toHaveLength(1)
  return toutes[0]!
}

// --- 1. users.setRole ----------------------------------------------------

test("changer un rôle laisse une trace nommant l'acteur, la cible et le rôle", async () => {
  const t = makeTestConvex()
  const { identity, id } = await seedActor(t)
  const cible = await seedCible(t)

  await identity.mutation(api.users.setRole, { userId: cible.id, role: "editor" })

  const ligne = await ligneUnique(t)
  expect(ligne.action).toBe("role.change")
  expect(ligne.acteurId).toBe(id)
  expect(ligne.acteurNom).toBe(NOM_ACTEUR)
  expect(ligne.cible).toBe(cible.email)
  expect(ligne.detail).toBe("editor")
})

// --- 2. users.remove -----------------------------------------------------

test("supprimer un compte laisse une trace nommant l'acteur et le compte", async () => {
  const t = makeTestConvex()
  const { identity, id } = await seedActor(t)
  const cible = await seedCible(t)

  await identity.mutation(api.users.remove, { userId: cible.id })

  const ligne = await ligneUnique(t)
  expect(ligne.action).toBe("user.remove")
  expect(ligne.acteurId).toBe(id)
  expect(ligne.acteurNom).toBe(NOM_ACTEUR)
  expect(ligne.cible).toBe(cible.email)
})

// --- 3. secrets.set ------------------------------------------------------

const SENTINELLE = "sk-or-la-valeur-secrete"

test("écrire un secret laisse une trace, et la trace ne contient pas le secret", async () => {
  const t = makeTestConvex()
  const { identity, id } = await seedActor(t)

  await identity.action(api.secrets.set, {
    nom: "OPENROUTER_API_KEY",
    valeur: SENTINELLE,
  })

  const ligne = await ligneUnique(t)
  expect(ligne.action).toBe("secret.set")
  expect(ligne.acteurId).toBe(id)
  expect(ligne.acteurNom).toBe(NOM_ACTEUR)
  expect(ligne.cible).toBe("OPENROUTER_API_KEY")
  // Le cœur du test : ni la valeur, ni un fragment de valeur. Les quatre
  // derniers caractères sont un fragment de secret — `secrets.status` a le
  // droit de les rendre à un owner devant son écran, un journal relu des
  // mois plus tard par plus de monde ne l'a pas.
  const json = JSON.stringify(await lignes(t))
  expect(json).not.toContain(SENTINELLE)
  expect(json).not.toContain(SENTINELLE.slice(-4))
})

test("remplacer un secret déjà posé se distingue de sa première écriture", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t)

  await identity.action(api.secrets.set, { nom: "OPENROUTER_API_KEY", valeur: SENTINELLE })
  await identity.action(api.secrets.set, { nom: "OPENROUTER_API_KEY", valeur: `${SENTINELLE}-2` })

  const toutes = await lignes(t)
  expect(toutes).toHaveLength(2)
  expect(toutes.map((l) => l.detail)).toEqual(["création", "remplacement"])
})

// --- 4. secrets.clear ----------------------------------------------------

test("retirer un secret laisse une trace nommant le jeton, jamais sa valeur", async () => {
  const t = makeTestConvex()
  const { identity, id } = await seedActor(t)
  await identity.action(api.secrets.set, { nom: "OPENROUTER_API_KEY", valeur: SENTINELLE })

  await identity.mutation(api.secrets.clear, { nom: "OPENROUTER_API_KEY" })

  const toutes = await lignes(t)
  const ligne = toutes.at(-1)!
  expect(ligne.action).toBe("secret.clear")
  expect(ligne.acteurId).toBe(id)
  expect(ligne.cible).toBe("OPENROUTER_API_KEY")
  expect(JSON.stringify(toutes)).not.toContain(SENTINELLE)
})

test("retirer un jeton absent n'invente pas de trace", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t)

  // Réponse ordinaire côté `secrets.clear` — deux onglets ouverts, et le
  // second clic n'a plus rien à supprimer. Journaliser ce non-geste
  // remplirait le journal de lignes qui ne décrivent rien.
  await identity.mutation(api.secrets.clear, { nom: "RESEND_API_KEY" })

  expect(await lignes(t)).toHaveLength(0)
})

// --- 5. leads.remove -----------------------------------------------------

const EMAIL_LEAD = "personne-effacee@exemple.fr"

test("supprimer une fiche laisse une trace — sans ressusciter l'adresse effacée", async () => {
  const t = makeTestConvex()
  const { identity, id } = await seedActor(t)
  const leadId = await t.run((ctx) =>
    ctx.db.insert("leads", {
      name: "Personne Effacée",
      email: EMAIL_LEAD,
      status: "new",
      lastMessageAt: Date.now(),
      messageCount: 1,
    }),
  )

  await identity.mutation(api.leads.remove, { id: leadId })

  const ligne = await ligneUnique(t)
  expect(ligne.action).toBe("lead.remove")
  expect(ligne.acteurId).toBe(id)
  expect(ligne.acteurNom).toBe(NOM_ACTEUR)
  // `dataSubject.ts` promet l'effacement. Recopier l'adresse dans un
  // journal qui, lui, ne s'efface pas, le défairait — l'identifiant de la
  // ligne disparue suffit à dire quel geste a eu lieu.
  const json = JSON.stringify(await lignes(t))
  expect(json).not.toContain(EMAIL_LEAD)
  expect(json).not.toContain("Personne Effacée")
})

// --- 6 & 7. pages.publishPage / pages.unpublish --------------------------

async function seedPage(t: TestConvex<typeof schema>, status: "draft" | "published") {
  return t.run((ctx) =>
    ctx.db.insert("pages", {
      slug: "une-page",
      title: "Une page",
      status,
      createdBy: "user_1",
      updatedBy: "user_1",
    }),
  )
}

test("publier une page laisse une trace nommant l'acteur et le slug", async () => {
  const t = makeTestConvex()
  const { identity, id } = await seedActor(t)
  const pageId = await seedPage(t, "draft")

  await identity.mutation(api.pages.publishPage, { id: pageId })

  const ligne = await ligneUnique(t)
  expect(ligne.action).toBe("page.publish")
  expect(ligne.acteurId).toBe(id)
  expect(ligne.acteurNom).toBe(NOM_ACTEUR)
  expect(ligne.cible).toBe("une-page")
})

test("dépublier une page laisse une trace nommant l'acteur et le slug", async () => {
  const t = makeTestConvex()
  const { identity, id } = await seedActor(t)
  const pageId = await seedPage(t, "published")

  await identity.mutation(api.pages.unpublish, { id: pageId })

  const ligne = await ligneUnique(t)
  expect(ligne.action).toBe("page.unpublish")
  expect(ligne.acteurId).toBe(id)
  expect(ligne.acteurNom).toBe(NOM_ACTEUR)
  expect(ligne.cible).toBe("une-page")
})

test("dépublier une page déjà dépubliée n'invente pas de trace", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t)
  const pageId = await seedPage(t, "draft")

  // `unpublish` renvoie sans rien écrire quand la page n'est pas publiée.
  // Une ligne « a dépublié » sur un geste qui n'a rien changé rendrait le
  // journal faux, ce qui est pire qu'incomplet.
  await identity.mutation(api.pages.unpublish, { id: pageId })

  expect(await lignes(t)).toHaveLength(0)
})

// --- 8. settings.update --------------------------------------------------

const SECRET_WEBHOOK = "secret-de-signature-qui-ne-doit-pas-fuiter"

test("modifier les réglages laisse une trace nommant les champs touchés", async () => {
  const t = makeTestConvex()
  const { identity, id } = await seedActor(t)

  await identity.mutation(api.settings.update, { siteName: "Nouveau nom" })

  const ligne = await ligneUnique(t)
  expect(ligne.action).toBe("settings.update")
  expect(ligne.acteurId).toBe(id)
  expect(ligne.acteurNom).toBe(NOM_ACTEUR)
  expect(ligne.detail).toBe("siteName")
})

test("la trace des réglages nomme les champs, jamais leurs valeurs", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t)

  await identity.mutation(api.settings.update, {
    leadWebhookUrl: "https://exemple.fr/hook",
    leadWebhookSecret: SECRET_WEBHOOK,
  })

  const ligne = await ligneUnique(t)
  expect(ligne.detail).toContain("leadWebhookSecret")
  // `settings` porte un secret de signature. Le journal dit qu'il a
  // changé ; il ne dit pas ce qu'il vaut.
  expect(JSON.stringify(await lignes(t))).not.toContain(SECRET_WEBHOOK)
})

// --- La lecture ----------------------------------------------------------

test("le journal se lit du plus récent au plus ancien, réservé aux owner et admin", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t)
  const pageId = await seedPage(t, "draft")
  await identity.mutation(api.pages.publishPage, { id: pageId })
  await identity.mutation(api.settings.update, { siteName: "Nouveau nom" })

  const journal = await identity.query(api.auditLog.list, {})
  expect(journal.map((l) => l.action)).toEqual(["settings.update", "page.publish"])
  // La phrase est calculée à la lecture, pas stockée : changer une
  // formulation ne demande pas de réécrire l'histoire.
  expect(journal[0]!.phrase).toContain(NOM_ACTEUR)
})

test("un editor ne lit pas le journal — il y figure", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t, "editor")
  await expect(identity.query(api.auditLog.list, {})).rejects.toThrow()
})

test("sans session, le journal est inatteignable", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.auditLog.list, {})).rejects.toThrow()
})

// --- Les formes que les écrans envoient VRAIMENT -------------------------
//
// `settings.update` reçoit toujours un formulaire entier, jamais un champ
// isolé : `identite.tsx` envoie `{ siteName, logoId, iconId }` à chaque
// pause de frappe (sauvegarde automatique, 1,5 s), et `webhook.tsx` envoie
// toujours l'URL ET le secret. Un journal qui nomme les champs SOUMIS
// affirme donc à chaque ligne que le logo et le secret de signature ont
// changé. C'est le défaut que ce fichier refuse partout ailleurs, avec sa
// propre formule : une ligne qui affirme un geste qui n'a pas eu lieu rend
// le journal faux, ce qui est pire qu'incomplet.

test("renommer le site ne fait pas dire au journal que le logo a changé", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t)

  // La forme exacte d'`identite.tsx`, `null` compris — pas `{ siteName }`,
  // que cet écran n'envoie jamais.
  await identity.mutation(api.settings.update, {
    siteName: "Premier nom",
    logoId: null,
    iconId: null,
  })
  await identity.mutation(api.settings.update, {
    siteName: "Second nom",
    logoId: null,
    iconId: null,
  })

  const toutes = await lignes(t)
  expect(toutes.map((l) => l.detail)).toEqual(["siteName", "siteName"])
})

test("changer la seule URL du webhook n'affirme pas que le secret de signature a changé", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t)

  // La forme exacte de `webhook.tsx` : les deux champs, toujours.
  await identity.mutation(api.settings.update, {
    leadWebhookUrl: "https://exemple.fr/hook",
    leadWebhookSecret: SECRET_WEBHOOK,
  })
  await identity.mutation(api.settings.update, {
    leadWebhookUrl: "https://exemple.fr/autre-hook",
    leadWebhookSecret: SECRET_WEBHOOK,
  })

  const toutes = await lignes(t)
  expect(toutes).toHaveLength(2)
  // Le secret n'a pas bougé : le journal ne doit pas le nommer, parce que
  // c'est le champ le plus sensible de la table et qu'une ligne qui
  // l'accuse à tort envoie chercher une compromission qui n'a pas eu lieu.
  expect(toutes[1]!.detail).toBe("leadWebhookUrl")
})

test("une sauvegarde automatique qui ne change rien n'écrit aucune ligne", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t)

  const formulaire = { siteName: "Mon site", logoId: null, iconId: null } as const
  await identity.mutation(api.settings.update, formulaire)
  await identity.mutation(api.settings.update, formulaire)
  await identity.mutation(api.settings.update, formulaire)

  // Une seule ligne pour trois envois : la première écriture a changé
  // quelque chose, les deux suivantes non.
  expect(await lignes(t)).toHaveLength(1)
})

test("un champ de structure ne compte comme changé que si son contenu diffère", async () => {
  const t = makeTestConvex()
  const { identity } = await seedActor(t)

  // `defaultSeo` et `socials` sont un objet et un tableau. Les comparer par
  // `JSON.stringify` ferait dépendre le résultat de l'ordre des clés, que
  // ni le formulaire ni la base ne garantissent.
  const seo = { title: "Titre", description: "Description" }
  await identity.mutation(api.settings.update, { defaultSeo: seo, socials: [] })
  await identity.mutation(api.settings.update, {
    defaultSeo: { description: "Description", title: "Titre" },
    socials: [],
  })

  expect(await lignes(t)).toHaveLength(1)
})

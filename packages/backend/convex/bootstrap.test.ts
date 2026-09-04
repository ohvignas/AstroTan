import { afterEach, beforeEach, expect, test } from "vitest"
import { api, internal } from "./_generated/api"
import { ORIGIN, makeTestConvex, seedUser } from "../testing/betterAuthFixture"

// Ce que ce fichier garde : le PREMIER compte d'un déploiement neuf.
//
// `bootstrap:createInvitation` est le seul chemin qui en crée un — accès
// sur invitation seule, `disableSignUp: true`, pas d'OAuth. Deux propriétés
// de ce chemin sont invisibles à la relecture et coûteuses à découvrir en
// production, donc elles sont épinglées ici :
//
//   1. le rôle du premier compte doit être `owner`, pas `admin`. Un
//      déploiement dont le premier compte est `admin` n'a JAMAIS d'owner :
//      `invitations.create` refuse `role: "owner"` à tout le monde, et un
//      admin ne peut ni inviter un admin, ni promouvoir, ni rétrograder,
//      ni supprimer un admin. Le déploiement est alors plafonné à un seul
//      administrateur, sans issue par l'interface ;
//   2. `pnpm bootstrap` est rejouable, donc il a besoin de savoir si un
//      owner existe déjà avant d'émettre une invitation de plus. C'est ce
//      que `bootstrap:owners` lui rend.

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
})

afterEach(() => {
  process.env = originalEnv
})

test("un déploiement neuf n'a aucun owner, et `bootstrap:owners` le dit", async () => {
  const t = makeTestConvex()
  expect(await t.query(internal.bootstrap.owners, {})).toEqual([])
})

test("`bootstrap:owners` rend l'adresse de l'owner existant — le signal qui rend `pnpm bootstrap` rejouable", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: "proprietaire@example.com",
    password: "correct horse battery staple 1",
    name: "Propriétaire",
    role: "owner",
  })

  expect(await t.query(internal.bootstrap.owners, {})).toEqual([
    "proprietaire@example.com",
  ])
})

test("le premier compte peut être `owner` : l'invitation d'amorçage passe la barrière qui refuse un second owner", async () => {
  const t = makeTestConvex()

  const invitation = await t.mutation(internal.bootstrap.createInvitation, {
    email: "proprietaire@example.com",
    role: "owner",
  })
  expect(invitation.role).toBe("owner")

  await t.mutation(api.invitations.accept, {
    token: invitation.token,
    password: "correct horse battery staple 1",
    name: "Propriétaire",
  })

  expect(await t.query(internal.bootstrap.owners, {})).toEqual([
    "proprietaire@example.com",
  ])
})

test("le piège : un premier compte `admin` ne peut pas en inviter un second, donc le déploiement reste plafonné", async () => {
  const t = makeTestConvex()

  const invitation = await t.mutation(internal.bootstrap.createInvitation, {
    email: "administrateur@example.com",
    role: "admin",
  })
  await t.mutation(api.invitations.accept, {
    token: invitation.token,
    password: "correct horse battery staple 1",
    name: "Administrateur",
  })

  // Aucun owner : c'est tout le problème, et rien dans l'interface ne le
  // dit. Ce que cet admin ne pourra jamais faire est vérifié par
  // `invitations.test.ts` et `users.test.ts` ; ce qu'on épingle ici est la
  // conséquence à l'échelle du déploiement.
  expect(await t.query(internal.bootstrap.owners, {})).toEqual([])
})

// `devAccessLink` est le chemin des agents locaux (`pnpm admin:dev-link`) :
// un lien `/accept-invite` frais, jamais un second owner, jamais un mot de
// passe. `createInvitation` refuse un second lien vivant pour la même
// adresse (ALREADY_INVITED) et n'est donc pas rejouable ; celui-ci remplace
// l'invitation en attente pour que la commande puisse l'être.

test("`devAccessLink` émet une invitation owner quand le déploiement n'en a pas", async () => {
  const t = makeTestConvex()
  const link = await t.mutation(internal.bootstrap.devAccessLink, {
    email: "premier@example.com",
  })
  expect(link).toEqual({
    kind: "accept-invite",
    email: "premier@example.com",
    role: "owner",
    token: expect.any(String),
  })
  expect(link.token.length).toBeGreaterThan(16)
})

test("`devAccessLink` n'émet jamais un second owner : editor si un owner existe déjà", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: "proprietaire@example.com",
    password: "correct horse battery staple 1",
    name: "Propriétaire",
    role: "owner",
  })

  const link = await t.mutation(internal.bootstrap.devAccessLink, {
    email: "agent@example.com",
  })
  expect(link.role).toBe("editor")
  expect(link.email).toBe("agent@example.com")
  expect(link.kind).toBe("accept-invite")
})

test("`devAccessLink` remplace l'invitation en attente, donc la commande est rejouable", async () => {
  const t = makeTestConvex()
  const premier = await t.mutation(internal.bootstrap.devAccessLink, {
    email: "agent@example.com",
  })
  const second = await t.mutation(internal.bootstrap.devAccessLink, {
    email: "agent@example.com",
  })
  expect(second.token).not.toBe(premier.token)

  await expect(
    t.query(api.invitations.preview, { token: premier.token }),
  ).rejects.toThrow()

  const apercu = await t.query(api.invitations.preview, { token: second.token })
  expect(apercu.email).toBe("agent@example.com")
})

test("`devAccessLink` refuse une adresse qui a déjà un compte — le jeton d'invitation ne sert plus", async () => {
  const t = makeTestConvex()
  await seedUser(t, {
    email: "proprietaire@example.com",
    password: "correct horse battery staple 1",
    name: "Propriétaire",
    role: "owner",
  })

  await expect(
    t.mutation(internal.bootstrap.devAccessLink, {
      email: "proprietaire@example.com",
    }),
  ).rejects.toThrow(/ACCOUNT_ALREADY_EXISTS/)
})

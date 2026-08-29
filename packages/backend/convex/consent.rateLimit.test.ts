import { beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import { makeTestConvex } from "../testing/betterAuthFixture"

// La limite de débit du journal de consentement, exercée de bout en bout.
//
// `lib/consentRateLimit.ts` porte la décision — le budget, la
// normalisation de la clé. Celui-ci vérifie qu'elle est réellement
// APPLIQUÉE dans `consent.record`, sur le même modèle que
// `leads.rateLimit.test.ts` pour le formulaire de contact : `consentId`
// vient du client, donc poster N identifiants distincts doit s'arrêter
// quelque part.

const SECRET = "a".repeat(64)

function geste(n: number, origin: string | undefined) {
  return {
    secret: SECRET,
    origin,
    consentVersion: "1.0.0",
    visitorId: `visiteur-${n}`,
    // Un identifiant par geste : c'est le compteur d'ORIGINE qu'on veut
    // voir mordre ici, jamais l'idempotence par `consentId`.
    consentId: `geste-${n}`,
    action: "custom" as const,
    timestamp: "2026-08-29T10:00:00.000Z",
    analytics: true,
    marketing: false,
    preferences: false,
  }
}

beforeEach(() => {
  process.env.CONSENT_LOG_SECRET = SECRET
})

test("une même origine ne peut pas enregistrer sans fin", async () => {
  const t = makeTestConvex()
  const origine = "a".repeat(64)

  // Le budget est de vingt par heure. Les vingt premiers passent.
  for (let n = 0; n < 20; n++) {
    await t.mutation(api.consent.record, geste(n, origine))
  }

  await expect(t.mutation(api.consent.record, geste(20, origine))).rejects.toMatchObject({
    data: { code: "RATE_LIMITED" },
  })

  // Et le refus ne laisse rien derrière lui : vingt lignes, pas vingt et une.
  const lignes = await t.run((ctx) => ctx.db.query("consentRecords").collect())
  expect(lignes).toHaveLength(20)
})

test("une autre origine garde son propre budget", async () => {
  // Sans quoi un seul auteur d'envois automatisés rendrait le journal muet
  // pour tout le monde.
  const t = makeTestConvex()
  for (let n = 0; n < 20; n++) {
    await t.mutation(api.consent.record, geste(n, "a".repeat(64)))
  }
  await expect(
    t.mutation(api.consent.record, geste(99, "b".repeat(64))),
  ).resolves.not.toThrow()
})

test("une origine absente ou démesurée ne donne pas un budget neuf à chaque envoi", async () => {
  // Le contournement le plus évident : ne rien envoyer, ou envoyer une
  // valeur différente à chaque fois. Les deux tombent dans le même seau.
  const t = makeTestConvex()
  for (let n = 0; n < 20; n++) {
    await t.mutation(api.consent.record, geste(n, undefined))
  }
  await expect(
    t.mutation(api.consent.record, geste(20, "x".repeat(200))),
  ).rejects.toMatchObject({ data: { code: "RATE_LIMITED" } })
})

test("rejouer le même geste ne consomme pas le budget", async () => {
  // `consent.record` est idempotente par `consentId` : une requête en
  // `keepalive` que le navigateur rejoue ne doit pas payer une seconde
  // fois le même geste. Sans ça, le budget de vingt serait en réalité plus
  // bas pour toute personne dont le navigateur rejoue.
  const t = makeTestConvex()
  const origine = "c".repeat(64)
  const un = geste(0, origine)

  for (let i = 0; i < 25; i++) {
    await t.mutation(api.consent.record, un)
  }

  const lignes = await t.run((ctx) => ctx.db.query("consentRecords").collect())
  expect(lignes).toHaveLength(1)

  // Le budget est resté intact : dix-neuf nouveaux gestes passent encore —
  // le vingtième au total, en comptant le tout premier, qui a lui, seul,
  // consommé un jeton.
  for (let n = 1; n <= 19; n++) {
    await t.mutation(api.consent.record, geste(n, origine))
  }
  const total = await t.run((ctx) => ctx.db.query("consentRecords").collect())
  expect(total).toHaveLength(20)

  // Le vingt-et-unième identifiant distinct, lui, mord.
  await expect(
    t.mutation(api.consent.record, geste(20, origine)),
  ).rejects.toMatchObject({ data: { code: "RATE_LIMITED" } })
})

import { afterEach, beforeEach, expect, test } from "vitest"
import { api } from "./_generated/api"
import { makeTestConvex } from "../testing/betterAuthFixture"

// La limite de débit du formulaire, exercée de bout en bout.
//
// Le fichier `lib/leadRateLimit.test.ts` couvre la décision — les budgets,
// la normalisation de la clé. Celui-ci vérifie qu'elle est réellement
// APPLIQUÉE : c'est le câblage qui manquait, pas la politique.

const SECRET = "un-secret-partage-de-plus-de-32-caracteres"
let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.LEAD_SUBMIT_SECRET = SECRET
})

afterEach(() => {
  process.env = originalEnv
})

function envoi(n: number, origin: string) {
  return {
    secret: SECRET,
    origin,
    name: `Visiteur ${n}`,
    // Une adresse par envoi : c'est le compteur d'ORIGINE qu'on veut voir
    // mordre ici, pas celui d'adresse, qui est plus serré.
    email: `visiteur-${n}@exemple.fr`,
    body: "Bonjour, j'aimerais des informations.",
  }
}

test("une même origine ne peut pas envoyer sans fin", async () => {
  const t = makeTestConvex()
  const origine = "a".repeat(64)

  // Le budget est de cinq par heure. Les cinq premiers passent.
  for (let n = 0; n < 5; n++) {
    await t.mutation(api.leads.submit, envoi(n, origine))
  }

  await expect(t.mutation(api.leads.submit, envoi(5, origine))).rejects.toMatchObject({
    data: { code: "RATE_LIMITED" },
  })

  // Et le refus ne laisse rien derrière lui : cinq fiches, pas six.
  const fiches = await t.run((ctx) => ctx.db.query("leads").collect())
  expect(fiches).toHaveLength(5)
})

test("une autre origine garde son propre budget", async () => {
  // Sans quoi un seul auteur d'envois automatisés rendrait le formulaire
  // muet pour tout le monde.
  const t = makeTestConvex()
  for (let n = 0; n < 5; n++) {
    await t.mutation(api.leads.submit, envoi(n, "a".repeat(64)))
  }
  await expect(
    t.mutation(api.leads.submit, envoi(99, "b".repeat(64))),
  ).resolves.not.toThrow()
})

test("une même adresse est plus serrée que l'origine", async () => {
  // Trois par heure : c'est ce compteur qui protège la boîte de réception.
  const t = makeTestConvex()
  const commun = { secret: SECRET, origin: "c".repeat(64), name: "Habitué", body: "Encore moi." }
  for (let n = 0; n < 3; n++) {
    await t.mutation(api.leads.submit, { ...commun, email: "habitue@exemple.fr" })
  }
  await expect(
    t.mutation(api.leads.submit, { ...commun, email: "HABITUE@Exemple.FR" }),
  ).rejects.toMatchObject({ data: { code: "RATE_LIMITED" } })
})

test("une origine absente ne donne pas un budget neuf à chaque envoi", async () => {
  // Le contournement le plus évident : ne rien envoyer, ou envoyer une
  // valeur différente à chaque fois. Les deux tombent dans le même seau.
  const t = makeTestConvex()
  for (let n = 0; n < 5; n++) {
    await t.mutation(api.leads.submit, { ...envoi(n, ""), origin: undefined })
  }
  await expect(
    t.mutation(api.leads.submit, { ...envoi(5, ""), origin: "   " }),
  ).rejects.toMatchObject({ data: { code: "RATE_LIMITED" } })
})

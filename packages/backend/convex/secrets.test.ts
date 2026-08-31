import { afterEach, beforeEach, expect, test } from "vitest"
import type { ActionCtx } from "./_generated/server"
import { api } from "./_generated/api"
import { lireSecret } from "./secrets"
import type { SecretNom } from "./secrets"
import { SECRETS_KEY_VAR } from "./lib/secretsCrypto"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  seedUser,
  signIn,
} from "../testing/betterAuthFixture"

// ---------------------------------------------------------------------
// Les jetons saisis depuis l'écran.
//
// Ce fichier garde deux frontières, et elles ne se recouvrent pas :
//
//   1. **Aucune valeur ne ressort.** Même modèle que
//      `settings.environment.test.ts` : une valeur sentinelle est écrite,
//      et le JSON de chaque query doit ne pas la contenir — ni elle, ni
//      l'IV, ni le chiffré. Ce test est ce qui échoue le jour où quelqu'un
//      ajoute « juste pour vérifier » un champ `valeur` à `status`.
//
//   2. **L'environnement gagne.** La précédence est décidée dans
//      `lireSecret` et nulle part ailleurs ; si un appelant la recopiait à
//      sa façon, ces tests ne le verraient pas — mais l'existence d'un seul
//      helper testé est ce qui rend la recopie inutile.
// ---------------------------------------------------------------------

let originalEnv: NodeJS.ProcessEnv

/** 32 octets, en base64, comme la commande de l'écran en produit. */
const CLE_MAITRESSE = btoa(
  String.fromCharCode(...new Uint8Array(32).map((_, i) => (i * 7 + 13) % 251))
)

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env[SECRETS_KEY_VAR] = CLE_MAITRESSE
  delete process.env.OPENROUTER_API_KEY
  delete process.env.UMAMI_API_PASSWORD
})

afterEach(() => {
  process.env = originalEnv
})

async function seedActor(role: "owner" | "admin" | "editor") {
  const t = makeTestConvex()
  const email = `secrets-${role}-${Date.now()}-${Math.random()}@example.com`
  const password = "correct horse battery staple secrets"
  const user = await seedUser(t, { email, password, name: `Actor ${role}`, role })
  await signIn(t, email, password)
  return { t, identity: await identityFor(t, user.id) }
}

const SENTINELLE = "sk-or-v1-VALEUR-QUI-NE-DOIT-JAMAIS-RESSORTIR-9876"

// ---------------------------------------------------------------------
// Rôles
// ---------------------------------------------------------------------

test("sans session, on ne lit ni n'écrit rien", async () => {
  const t = makeTestConvex()
  await expect(t.query(api.secrets.status, {})).rejects.toThrow()
  await expect(
    t.action(api.secrets.set, { nom: "OPENROUTER_API_KEY", valeur: SENTINELLE })
  ).rejects.toThrow()
  await expect(
    t.mutation(api.secrets.clear, { nom: "OPENROUTER_API_KEY" })
  ).rejects.toThrow()
})

test("un editor est refusé — classer des leads n'est pas détenir une clé de facturation", async () => {
  const { identity } = await seedActor("editor")
  // Volontairement plus strict que `settings.environment`, qui laisse un
  // editor lire des booléens : savoir quelles clés sont posées, lesquelles
  // manquent et laquelle est illisible dessine l'état de sécurité du
  // déploiement.
  await expect(identity.query(api.secrets.status, {})).rejects.toThrow()
  await expect(
    identity.action(api.secrets.set, {
      nom: "OPENROUTER_API_KEY",
      valeur: SENTINELLE,
    })
  ).rejects.toThrow()
  await expect(
    identity.mutation(api.secrets.clear, { nom: "OPENROUTER_API_KEY" })
  ).rejects.toThrow()
})

test("un admin peut poser un jeton", async () => {
  const { identity } = await seedActor("admin")
  await identity.action(api.secrets.set, {
    nom: "RESEND_API_KEY",
    valeur: "re_une-cle-de-test-1234",
  })
  const etat = await identity.query(api.secrets.status, {})
  const ligne = etat.secrets.find((s) => s.nom === "RESEND_API_KEY")
  expect(ligne?.base).toBe(true)
})

test("DATAFORSEO_LOGIN et DATAFORSEO_PASSWORD sont des noms autorisés", async () => {
  const { identity } = await seedActor("owner")
  delete process.env.DATAFORSEO_LOGIN
  delete process.env.DATAFORSEO_PASSWORD
  await identity.action(api.secrets.set, { nom: "DATAFORSEO_LOGIN", valeur: "login@exemple.fr" })
  await identity.action(api.secrets.set, { nom: "DATAFORSEO_PASSWORD", valeur: "mot-de-passe-api" })
  const etat = await identity.query(api.secrets.status, {})
  expect(etat.secrets.find((s) => s.nom === "DATAFORSEO_LOGIN")?.source).toBe("base")
  expect(etat.secrets.find((s) => s.nom === "DATAFORSEO_PASSWORD")?.source).toBe("base")
  expect(JSON.stringify(etat)).not.toContain("mot-de-passe-api")
})

// ---------------------------------------------------------------------
// Aucune valeur ne ressort
// ---------------------------------------------------------------------

test("status ne rend jamais la valeur, ni l'IV, ni le chiffré", async () => {
  const { identity } = await seedActor("owner")
  await identity.action(api.secrets.set, {
    nom: "OPENROUTER_API_KEY",
    valeur: SENTINELLE,
  })

  const etat = await identity.query(api.secrets.status, {})
  const ligne = etat.secrets.find((s) => s.nom === "OPENROUTER_API_KEY")

  // La moitié positive : sans elle, un `return {}` ferait passer
  // l'assertion de non-fuite ci-dessous sans rien garder du tout.
  expect(ligne?.base).toBe(true)
  expect(ligne?.source).toBe("base")
  // `quatreDerniers` n'a plus aucun lecteur côté écran (voir
  // `apps/admin/src/components/settings-secrets.tsx`) : un fragment de
  // secret qu'on cesse d'afficher n'a plus de raison de traverser le
  // réseau. Ce test rougit si la query le rend à nouveau.
  expect(ligne).not.toHaveProperty("quatreDerniers")

  const rendu = JSON.stringify(etat)
  expect(rendu).not.toContain(SENTINELLE)
  // Les noms des champs bruts autant que leur contenu : le jour où
  // quelqu'un les recopie « pour déboguer », ce test le dit.
  expect(rendu).not.toContain("chiffre")
  expect(rendu).not.toContain("\"iv\"")
  expect(rendu).not.toContain("quatreDerniers")
})

test("la valeur en clair n'est nulle part dans la table", async () => {
  const { t, identity } = await seedActor("owner")
  await identity.action(api.secrets.set, {
    nom: "UMAMI_API_PASSWORD",
    valeur: SENTINELLE,
  })
  const lignes = await t.run((ctx) => ctx.db.query("secrets").collect())
  expect(lignes).toHaveLength(1)
  expect(JSON.stringify(lignes)).not.toContain(SENTINELLE)
})

test("les secrets ne sont pas dans la table settings, ni dans sa projection publique", async () => {
  const { t, identity } = await seedActor("owner")
  await identity.action(api.secrets.set, {
    nom: "OPENROUTER_API_KEY",
    valeur: SENTINELLE,
  })
  // `settings.get` est PUBLIQUE : appelée sans session, c'est exactement ce
  // qu'un inconnu obtient. C'est la raison pour laquelle les secrets ont
  // leur propre table.
  const publique = await t.query(api.settings.get, {})
  expect(JSON.stringify(publique)).not.toContain(SENTINELLE)
  const privee = await identity.query(api.settings.getPrivate, {})
  expect(JSON.stringify(privee)).not.toContain(SENTINELLE)
})

// ---------------------------------------------------------------------
// La clé maîtresse
// ---------------------------------------------------------------------

test("sans SECRETS_KEY, l'écriture refuse et donne la commande", async () => {
  const { identity } = await seedActor("owner")
  delete process.env[SECRETS_KEY_VAR]

  // Le point le plus important du dispositif : jamais de repli sur un
  // stockage en clair. Un chiffrement à clé absente est décoratif.
  await expect(
    identity.action(api.secrets.set, {
      nom: "OPENROUTER_API_KEY",
      valeur: SENTINELLE,
    })
  ).rejects.toThrow(/SECRETS_KEY_MISSING/)

  const etat = await identity.query(api.secrets.status, {})
  expect(etat.cleMaitresse).toBe("absente")
})

test("une SECRETS_KEY mal formée est distinguée d'une absence", async () => {
  const { identity } = await seedActor("owner")
  process.env[SECRETS_KEY_VAR] = "trop-courte"
  await expect(
    identity.action(api.secrets.set, {
      nom: "OPENROUTER_API_KEY",
      valeur: SENTINELLE,
    })
  ).rejects.toThrow(/SECRETS_KEY_MALFORMED/)
  expect((await identity.query(api.secrets.status, {})).cleMaitresse).toBe(
    "illisible"
  )
})

test("une clé maîtresse changée rend la ligne illisible plutôt que verte", async () => {
  const { identity } = await seedActor("owner")
  await identity.action(api.secrets.set, {
    nom: "OPENROUTER_API_KEY",
    valeur: SENTINELLE,
  })
  // La clé a été régénérée sur le déploiement : les lignes existantes ne se
  // déchiffrent plus. Une pastille verte sur une valeur perdue serait le
  // pire des deux mondes.
  process.env[SECRETS_KEY_VAR] = btoa(
    String.fromCharCode(...new Uint8Array(32).fill(3))
  )
  const ligne = (await identity.query(api.secrets.status, {})).secrets.find(
    (s) => s.nom === "OPENROUTER_API_KEY"
  )
  expect(ligne?.base).toBe(true)
  expect(ligne?.illisible).toBe(true)
  expect(ligne?.source).toBe("aucune")
})

// ---------------------------------------------------------------------
// Écriture et retrait
// ---------------------------------------------------------------------

test("une valeur vide est refusée : pour retirer, il y a clear", async () => {
  const { identity } = await seedActor("owner")
  await expect(
    identity.action(api.secrets.set, { nom: "OPENROUTER_API_KEY", valeur: "   " })
  ).rejects.toThrow(/EMPTY_SECRET/)
})

test("réécrire remplace la ligne au lieu d'en ajouter une seconde", async () => {
  const { t, identity } = await seedActor("owner")
  await identity.action(api.secrets.set, {
    nom: "OPENROUTER_API_KEY",
    valeur: "sk-or-premiere-1111",
  })
  await identity.action(api.secrets.set, {
    nom: "OPENROUTER_API_KEY",
    valeur: "sk-or-seconde-2222",
  })
  const lignes = await t.run((ctx) => ctx.db.query("secrets").collect())
  expect(lignes).toHaveLength(1)
})

test("clear retire la ligne, et un second clear ne lève pas", async () => {
  const { identity } = await seedActor("owner")
  await identity.action(api.secrets.set, {
    nom: "OPENROUTER_API_KEY",
    valeur: SENTINELLE,
  })
  await identity.mutation(api.secrets.clear, { nom: "OPENROUTER_API_KEY" })
  const apres = (await identity.query(api.secrets.status, {})).secrets.find(
    (s) => s.nom === "OPENROUTER_API_KEY"
  )
  expect(apres?.base).toBe(false)
  expect(apres?.source).toBe("aucune")
  // Deux onglets ouverts : le second clic n'a plus rien à supprimer, et ce
  // n'est pas une erreur.
  await expect(
    identity.mutation(api.secrets.clear, { nom: "OPENROUTER_API_KEY" })
  ).resolves.toBeNull()
})

// ---------------------------------------------------------------------
// La précédence — l'ENVIRONNEMENT gagne
// ---------------------------------------------------------------------

test("status dit que l'environnement l'emporte sur la base", async () => {
  const { identity } = await seedActor("owner")
  await identity.action(api.secrets.set, {
    nom: "OPENROUTER_API_KEY",
    valeur: SENTINELLE,
  })
  process.env.OPENROUTER_API_KEY = "sk-or-posee-par-la-cli"

  const ligne = (await identity.query(api.secrets.status, {})).secrets.find(
    (s) => s.nom === "OPENROUTER_API_KEY"
  )
  // Les deux existent, et l'écran doit pouvoir dire LEQUEL sert — sans
  // quoi quelqu'un saisit une clé et cherche pendant une heure pourquoi
  // elle n'a aucun effet.
  expect(ligne?.environnement).toBe(true)
  expect(ligne?.base).toBe(true)
  expect(ligne?.source).toBe("environnement")
})

// `lireSecret` est appelée DIRECTEMENT, à travers le `ctx` que `t.run`
// fournit (il porte `runQuery`, tout ce dont le helper a besoin), plutôt
// qu'à travers une fonction Convex ajoutée pour les tests : un point
// d'entrée qui n'existe que pour être testé finit par être appelé pour
// autre chose.
function lire(t: ReturnType<typeof makeTestConvex>, nom: SecretNom) {
  return t.run(async (ctx) => lireSecret(ctx as unknown as ActionCtx, nom))
}

test("lireSecret rend la variable d'environnement quand elle existe", async () => {
  const { t, identity } = await seedActor("owner")
  await identity.action(api.secrets.set, {
    nom: "OPENROUTER_API_KEY",
    valeur: SENTINELLE,
  })
  process.env.OPENROUTER_API_KEY = "sk-or-posee-par-la-cli"
  expect(await lire(t, "OPENROUTER_API_KEY")).toBe("sk-or-posee-par-la-cli")
})

test("lireSecret retombe sur la base quand l'environnement est muet", async () => {
  const { t, identity } = await seedActor("owner")
  await identity.action(api.secrets.set, {
    nom: "OPENROUTER_API_KEY",
    valeur: SENTINELLE,
  })
  expect(await lire(t, "OPENROUTER_API_KEY")).toBe(SENTINELLE)
})

test("lireSecret rend null quand rien n'est posé nulle part", async () => {
  const { t } = await seedActor("owner")
  expect(await lire(t, "UMAMI_API_PASSWORD")).toBeNull()
})

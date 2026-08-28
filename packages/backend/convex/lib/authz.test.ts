import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import schema from "../schema"
import { MUTATION_REGISTRY } from "../_registry"
// Import statique : garantit que `MUTATION_REGISTRY` est peuplé avant que
// la boucle de matrice plus bas ne s'exécute, à la *collecte* des tests
// (elle construit un `test()` par entrée, donc avant qu'aucun corps de
// test ne tourne) — voir `packages/backend/testing/registryModules.ts`
// pour le mécanisme complet. Sans cet import, cette boucle tournait sur
// un registre vide et générait silencieusement zéro test de permission,
// alors même que `_registry.test.ts` passait quand même (l'entrée y était
// bien déclarée, juste jamais chargée dans CE fichier). C'est exactement
// le trou que la review a débusqué.
//
// `packages/backend/testing/` (pas `convex/testing/`, round 2 du fix) :
// voir l'en-tête de `betterAuthFixture.ts` pour la mesure contre un vrai
// `convex dev --once` qui a motivé de sortir tout ceci de `convex/`.
import "../../testing/registryModules"
import {
  decideAccess,
  isCurrentlyBanned,
  parseRole,
  requireOwnDocument,
  requireRole,
} from "./authz"
import type { Role } from "../validators"
import {
  ORIGIN,
  identityFor,
  makeTestConvex,
  modules,
  seedUser,
  signIn,
} from "../../testing/betterAuthFixture"

let originalEnv: NodeJS.ProcessEnv

// Requis dès que la matrice plus bas seed un vrai utilisateur Better
// Auth : `createAuth` (appelé par `seedUser`) exige `BETTER_AUTH_SECRET`/
// `SITE_URL` par défaut (`requireSecret: true`). Les tests purs
// (`decideAccess`, `parseRole`, …) et le rejet non-authentifié plus bas
// n'en ont pas besoin, mais les poser inconditionnellement dans
// `beforeEach` ne leur nuit pas.
beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  // Task 8's `pages.mintPreviewToken` entry (`MUTATION_REGISTRY`) calls
  // `signPreviewToken`, which throws if this is unset — same floor
  // (32 chars) as every other test that seeds it, e.g.
  // `pages.test.ts`/`lib/previewToken.test.ts`.
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
})

afterEach(() => {
  process.env = originalEnv
})

// requireOwnDocument est une fonction pure : elle se teste sans Convex.
test("un editor ne peut écrire que ses propres documents", () => {
  const editor = { _id: "u_1", role: "editor" as const }
  expect(() => requireOwnDocument(editor, { createdBy: "u_1" })).not.toThrow()
  expect(() => requireOwnDocument(editor, { createdBy: "u_2" })).toThrow(/FORBIDDEN/)
})

test("un admin écrit les documents des autres", () => {
  const adminUser = { _id: "u_1", role: "admin" as const }
  expect(() => requireOwnDocument(adminUser, { createdBy: "u_2" })).not.toThrow()
})

// requireOwnDocument est une liste d'autorisation (owner/admin contournent),
// pas une liste de blocage sur "editor" : une valeur qui échappe au système
// de types (donnée externe mal validée en amont, par exemple) ne doit pas
// hériter silencieusement d'un accès en écriture sur tous les documents.
test("un rôle hors du système de types n'hérite pas d'un contournement de propriété", () => {
  const unknownRole = { _id: "u_1", role: "superadmin" as unknown as Role }
  expect(() => requireOwnDocument(unknownRole, { createdBy: "u_2" })).toThrow(/FORBIDDEN/)
})

// parseRole et isCurrentlyBanned sont les deux fonctions pures qui portent
// toute la logique de décision de requireRole. On les teste directement,
// sans passer par Convex, exactement comme requireOwnDocument ci-dessus —
// c'est ce qui permet de couvrir les chemins malheureux (rôle absent, null,
// inconnu ; ban sans expiration, avec expiration future, avec expiration
// passée) sans avoir à simuler une session Better Auth complète.
describe("parseRole — fail closed sur toute entrée qui n'est pas un rôle connu", () => {
  test("accepte les trois rôles connus", () => {
    expect(parseRole("owner")).toBe("owner")
    expect(parseRole("admin")).toBe("admin")
    expect(parseRole("editor")).toBe("editor")
  })

  test("refuse un rôle absent (undefined)", () => {
    expect(parseRole(undefined)).toBeNull()
  })

  test("refuse un rôle null", () => {
    expect(parseRole(null)).toBeNull()
  })

  test("refuse un rôle inconnu", () => {
    expect(parseRole("superadmin")).toBeNull()
  })

  test("refuse une valeur qui n'est pas une chaîne", () => {
    expect(parseRole(42)).toBeNull()
  })
})

describe("isCurrentlyBanned — un ban expiré ne bloque plus", () => {
  test("utilisateur non banni", () => {
    expect(isCurrentlyBanned({ banned: false })).toBe(false)
  })

  test("banned null (le schéma l'autorise) : non banni", () => {
    expect(isCurrentlyBanned({ banned: null })).toBe(false)
  })

  test("banni sans date d'expiration : ban permanent", () => {
    expect(isCurrentlyBanned({ banned: true, banExpires: undefined })).toBe(true)
  })

  test("banni avec banExpires null (le schéma l'autorise) : ban permanent", () => {
    expect(isCurrentlyBanned({ banned: true, banExpires: null })).toBe(true)
  })

  test("banni avec une expiration future : toujours banni", () => {
    expect(
      isCurrentlyBanned({ banned: true, banExpires: Date.now() + 60_000 }),
    ).toBe(true)
  })

  test("banni avec une expiration passée : n'est plus banni", () => {
    expect(
      isCurrentlyBanned({ banned: true, banExpires: Date.now() - 60_000 }),
    ).toBe(false)
  })
})

// decideAccess compose les trois vérifications (authentifié, non banni,
// rôle autorisé). Les primitives ci-dessus sont testées isolément, mais
// rien avant ce bloc ne prouvait que requireRole les assemble correctement
// — supprimer la vérification de ban à l'intérieur de decideAccess doit
// faire échouer un test ici, pas seulement laisser passer silencieusement.
describe("decideAccess — la composition, pas seulement les primitives", () => {
  test("authUser absent (null ou undefined) -> UNAUTHENTICATED", () => {
    expect(() => decideAccess(null, ["owner"])).toThrow(/UNAUTHENTICATED/)
    expect(() => decideAccess(undefined, ["owner"])).toThrow(/UNAUTHENTICATED/)
  })

  test("owner banni sans expiration -> BANNED, pas FORBIDDEN (le ban prime sur la vérification de rôle)", () => {
    expect(() => decideAccess({ role: "owner", banned: true }, ["owner"])).toThrow(
      /BANNED/,
    )
  })

  test("ban expiré -> la vérification de rôle reprend la main normalement", () => {
    expect(
      decideAccess(
        { role: "owner", banned: true, banExpires: Date.now() - 60_000 },
        ["owner"],
      ),
    ).toBe("owner")
  })

  test("rôle null -> FORBIDDEN", () => {
    expect(() => decideAccess({ role: null }, ["owner"])).toThrow(/FORBIDDEN/)
  })

  test("rôle inconnu -> FORBIDDEN", () => {
    expect(() => decideAccess({ role: "superadmin" }, ["owner"])).toThrow(/FORBIDDEN/)
  })

  test("rôle connu mais absent de la liste autorisée -> FORBIDDEN", () => {
    expect(() => decideAccess({ role: "editor" }, ["owner", "admin"])).toThrow(
      /FORBIDDEN/,
    )
  })

  test("rôle autorisé -> renvoie le rôle validé", () => {
    expect(decideAccess({ role: "admin" }, ["owner", "admin"])).toBe("admin")
  })
})

// requireRole lui-même : le seul chemin qu'on peut exercer de bout en bout
// sans enregistrer le composant Better Auth dans convex-test est le rejet
// non authentifié — `ctx.auth.getUserIdentity()` renvoie `null` avant même
// que `authComponent.safeGetAuthUser` n'ait besoin d'interroger le
// composant. On vérifie le code exact (`UNAUTHENTICATED`), pas seulement
// qu'une erreur est levée : c'est tout l'intérêt du switch vers
// `safeGetAuthUser` (Concern 1) — un appelant doit pouvoir brancher sur
// `error.data.code` de façon uniforme pour FORBIDDEN, BANNED et
// UNAUTHENTICATED.
test("requireRole rejette un appel non authentifié avec le code UNAUTHENTICATED", async () => {
  const t = convexTest(schema, modules)
  await expect(t.run((ctx) => requireRole(ctx, ["owner"]))).rejects.toMatchObject({
    data: { code: "UNAUTHENTICATED" },
  })
})

// Chaque entrée du registre est exercée contre une *vraie* session Better
// Auth pour chacun des trois rôles — pas contre une identité Convex nue
// (`t.withIdentity({subject: ...})` sans rien derrière). Toute mutation
// déclarée ici passe par `requireRole`, donc par
// `authComponent.safeGetAuthUser`, qui a besoin à la fois du composant
// `betterAuth` enregistré et d'un document `session` réel — une identité
// nue fait échouer l'appel avec "Component betterAuth is not registered",
// identiquement pour un rôle autorisé et un rôle refusé, ce qui est un
// faux résultat (ni un succès légitime, ni un FORBIDDEN) déguisé en
// n'importe lequel des deux selon l'assertion. `seedUser`/`signIn`/
// `identityFor` (`packages/backend/testing/betterAuthFixture.ts`)
// construisent le
// scénario réel : composant enregistré, utilisateur créé avec le rôle
// testé (ce qui fait aussi tourner `onCreate` pour de vrai, donc son
// profil existe déjà si la mutation en a besoin), session ouverte,
// identité Convex qui pointe vers cette session.
describe("matrice de permissions", () => {
  test("chaque entrée du registre est bien formée", () => {
    for (const e of MUTATION_REGISTRY) {
      expect(typeof e.name).toBe("string")
      expect(e.allowedRoles.length).toBeGreaterThan(0)
      expect(typeof e.invoke).toBe("function")
    }
  })

  // Canari anti-régression : si `MUTATION_REGISTRY` retombe à zéro (barrel
  // cassé, import statique retiré par erreur ailleurs), CE test échoue
  // bruyamment — plutôt que la boucle `for (const entry of
  // MUTATION_REGISTRY)` ci-dessous ne génère silencieusement aucun test,
  // ce qui est précisément le trou que la review a débusqué : un registre
  // vide fait passer `_registry.test.ts` (rien à comparer) tout en ne
  // produisant aucun test de permission ici.
  test("le registre n'est pas vide (sinon cette matrice ne teste rien)", () => {
    expect(MUTATION_REGISTRY.length).toBeGreaterThan(0)
  })

  for (const entry of MUTATION_REGISTRY) {
    for (const role of ["owner", "admin", "editor"] as const) {
      const allowed = entry.allowedRoles.includes(role)
      test(`${entry.name} — ${role} ${allowed ? "autorisé" : "refusé"}`, async () => {
        const t = makeTestConvex()
        const email = `${entry.name.replace(/[^a-z0-9]+/gi, "_")}_${role}@example.com`
        const password = "correct horse battery staple 1"
        const user = await seedUser(t, { email, password, name: "Matrix Subject", role })
        await signIn(t, email, password)
        const identity = await identityFor(t, user.id)
        const call = () => entry.invoke(identity)
        if (allowed) {
          await call()
        } else {
          // Un `rejects.toThrow()` sans le motif `/FORBIDDEN/` laisserait
          // passer ce cas pour la mauvaise raison — un bug sans rapport
          // avec l'autorisation qui ferait aussi lever la mutation.
          await expect(call()).rejects.toThrow(/FORBIDDEN/)
        }
      })
    }
  }
})

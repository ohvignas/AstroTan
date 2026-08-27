import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "../schema"
import { MUTATION_REGISTRY } from "../_registry"
import {
  isCurrentlyBanned,
  parseRole,
  requireOwnDocument,
  requireRole,
} from "./authz"

const modules = import.meta.glob("../**/*.ts")

// requireOwnDocument est une fonction pure : elle se teste sans Convex.
test("un editor ne peut écrire que ses propres documents", () => {
  const editor = { _id: "u_1", role: "editor" }
  expect(() => requireOwnDocument(editor, { createdBy: "u_1" })).not.toThrow()
  expect(() => requireOwnDocument(editor, { createdBy: "u_2" })).toThrow(/FORBIDDEN/)
})

test("un admin écrit les documents des autres", () => {
  const adminUser = { _id: "u_1", role: "admin" }
  expect(() => requireOwnDocument(adminUser, { createdBy: "u_2" })).not.toThrow()
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

  test("banni sans date d'expiration : ban permanent", () => {
    expect(isCurrentlyBanned({ banned: true, banExpires: undefined })).toBe(true)
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

// requireRole lui-même : le seul chemin qu'on peut exercer de bout en bout
// sans enregistrer le composant Better Auth dans convex-test est le rejet
// non authentifié — `ctx.auth.getUserIdentity()` renvoie `null` avant même
// que `authComponent.getAuthUser` n'ait besoin d'interroger le composant.
test("requireRole rejette un appel non authentifié", async () => {
  const t = convexTest(schema, modules)
  await expect(t.run((ctx) => requireRole(ctx, ["owner"]))).rejects.toThrow()
})

// À la Task 5 le registre est vide : la boucle ne produit aucun test. C'est
// volontaire. Les entrées arrivent avec les mutations qu'elles décrivent
// (Tasks 7, 8, 10), et le test d'exhaustivité du Step 5 empêche d'en oublier.
describe("matrice de permissions", () => {
  for (const entry of MUTATION_REGISTRY) {
    for (const role of ["owner", "admin", "editor"] as const) {
      const allowed = entry.allowedRoles.includes(role)
      test(`${entry.name} — ${role} ${allowed ? "autorisé" : "refusé"}`, async () => {
        const t = convexTest(schema, modules)
        const call = () => entry.invoke(t.withIdentity({ subject: `u_${role}` }))
        if (allowed) await expect(call()).resolves.not.toThrow()
        else await expect(call()).rejects.toThrow(/FORBIDDEN/)
      })
    }
  }
})

test("toute mutation exportée est déclarée dans le registre", async () => {
  // Deux fichiers de `convex/*.ts` ne survivent pas à un import eager hors
  // du runtime Convex, et ni l'un ni l'autre ne peut exporter de mutation —
  // les exclure du glob ne réduit donc pas la couverture du garde-fou :
  //  - `convex.config.ts` est le fichier de configuration des composants
  //    (`defineApp()` / `app.use(...)`), interprété par le bundler Convex
  //    lui-même ; l'importer ailleurs lève "This code only works in Convex
  //    runtime".
  //  - `http.ts` appelle `authComponent.registerRoutes(http, createAuth)`
  //    au niveau module, qui construit `createAuth({})` immédiatement et
  //    déclenche le garde de secret de `auth.ts` ("BETTER_AUTH_SECRET is
  //    not set"). Sa seule export est le routeur HTTP lui-même
  //    (`export default http`), jamais une mutation.
  const modules = import.meta.glob(
    ["../*.ts", "!../convex.config.ts", "!../http.ts"],
    { eager: true },
  )
  const declared = new Set(MUTATION_REGISTRY.map((e) => e.name))
  const missing: string[] = []
  for (const [path, mod] of Object.entries(modules)) {
    const file = path.replace(/^\.\.\//, "").replace(/\.ts$/, "")
    if (file.startsWith("_") || file === "schema") continue
    for (const [name, fn] of Object.entries(mod as Record<string, any>)) {
      if (fn?.isMutation && !declared.has(`${file}.${name}`)) missing.push(`${file}.${name}`)
    }
  }
  expect(missing).toEqual([])
})

import { expect, test } from "vitest"
import { MUTATION_REGISTRY } from "./_registry"

// Ce test vit à côté du registre qu'il garde, à la racine de l'arbre
// balayé — c'est ce qui rend le préfixe qu'il retire de chaque clé de glob
// uniforme. Vite émet les clés de `import.meta.glob` relatives au module
// *importateur*, pas à la racine du glob : si ce test vivait dans
// `convex/lib/` (comme avant), `convex/auth.ts` apparaîtrait sous la clé
// `../auth.ts` mais `convex/lib/authz.ts` sous `./authz.ts` — deux formes
// différentes, dont un seul `replace(/^\.\.\//, "")` peut normaliser. Le
// nom produit pour tout fichier de `lib/` restait alors préfixé `./` et ne
// pouvait plus jamais matcher une entrée du registre déclarée `lib.x.y`.
// Ici, chaque clé partage le même préfixe (`./`) quelle que soit sa
// profondeur, donc un seul strip suffit et le résultat ne dépend plus de
// l'endroit où ce fichier de test se trouve dans l'arbre.
test("toute mutation exportée est déclarée dans le registre", async () => {
  // Le composant Better Auth (`betterAuth/`) et les deux fichiers
  // d'infrastructure ci-dessous sont exclus du balayage, sans réduire la
  // couverture du garde-fou :
  //  - `betterAuth/adapter.ts` ré-exporte 5 `mutationGeneric` (`create`,
  //    `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, sur 7 exports
  //    au total avec les 2 `queryGeneric`) construits par `createApi` — ce
  //    sont des fonctions du composant, pas de l'application ; les
  //    déclarer dans notre registre n'aurait aucun sens (elles ne passent
  //    jamais par `requireRole`). `betterAuth/_generated/` porte aussi des
  //    objets qui ressemblent à des fonctions à ce test naïf.
  //  - `convex.config.ts` est interprété par le bundler Convex lui-même
  //    (`defineApp()` / `app.use(...)`) et lève "This code only works in
  //    Convex runtime" hors de ce contexte ; il n'exporte aucune fonction.
  //  - `http.ts` construit `createAuth({})` au niveau module via
  //    `authComponent.registerRoutes`, ce qui déclenche le garde de secret
  //    de `auth.ts` sans `BETTER_AUTH_SECRET` ; sa seule export est le
  //    routeur HTTP, jamais une mutation.
  // Volontairement lazy (pas `{ eager: true }`) et sur `./**/*.ts`
  // (récursif, pas seulement le niveau racine de `convex/`) : Convex lui
  // -même bundle tout l'arbre, `_`-préfixé ou non, donc une mutation dans
  // `convex/lib/*.ts` doit être visible par ce garde-fou. Un fichier non
  // importable est maintenant un **échec** du test (l'`await load()` lève),
  // pas une disparition silencieuse de la couverture.
  const SKIP_PREFIXES = ["_generated/", "betterAuth/"]
  const SKIP_FILES = new Set(["convex.config.ts", "http.ts"])
  const all = import.meta.glob("./**/*.ts")
  const declared = new Set(MUTATION_REGISTRY.map((e) => e.name))
  const missing: string[] = []
  for (const [path, load] of Object.entries(all)) {
    const rel = path.replace(/^\.\//, "")
    if (rel.endsWith(".test.ts") || SKIP_FILES.has(rel)) continue
    if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue
    const mod = await load()
    const file = rel.replace(/\.ts$/, "")
    if (file === "schema") continue
    for (const [name, fn] of Object.entries(mod as Record<string, any>)) {
      // `isPublic` exclut les `internalMutation` (qui posent aussi
      // `isMutation = true`) : elles ne s'appellent pas via
      // `t.withIdentity(...)` comme la matrice le fait, donc les exiger
      // dans ce registre serait incohérent avec la façon dont elles sont
      // réellement atteintes.
      if (fn?.isMutation && fn?.isPublic && !declared.has(`${file}.${name}`)) {
        missing.push(`${file}.${name}`)
      }
    }
  }
  expect(missing).toEqual([])
})

import { expect, test } from "vitest"
import { MUTATION_REGISTRY } from "./_registry"
// Import statique, pas seulement la boucle de scan ci-dessous : garantit
// que le registre est peuplé indépendamment des détails d'ordre de cette
// boucle (déjà corrigés une fois plus bas) et fait de ce fichier + son
// import une seule source de vérité, partagée avec `lib/authz.test.ts`,
// pour "le registre est prêt avant qu'on le lise". Vit sous
// `packages/backend/testing/` (round 2 du fix), pas `convex/` : ce
// barrel n'a aucun rôle en production, voir son en-tête.
import "../testing/registryModules"

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
test("toute mutation ET action publique exportée est déclarée dans le registre", async () => {
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
  const SKIP_FILES = new Set([
    "convex.config.ts",
    "http.ts",
    // CJS yoastseo (~5 Mo) : le glob `load()` tourne en edge-runtime et
    // casserait toute la suite. Aucune mutation publique ici.
    "lib/yoastRun.ts",
  ])
  const all = import.meta.glob("./**/*.ts")
  // Collected as `{file}.{name}` candidates first, *not* filtered against
  // `declared` inline — see below for why.
  const publicMutations: string[] = []
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
      // Les ACTIONS publiques comptent aussi, et c'est un élargissement.
      // Le filtre ne retenait que `isMutation` : quatre actions publiques
      // échappaient donc au registre, dont `secrets.set` — celle qui écrit
      // un jeton chiffré. Une revue de sécurité l'a relevé. Les quatre
      // appelaient bien `requireRole`, le trou était dans la PREUVE et non
      // dans le code, mais un garde-fou qui ne regarde qu'une moitié des
      // portes n'en garde aucune.
      if ((fn?.isMutation || fn?.isAction) && fn?.isPublic) {
        publicMutations.push(`${file}.${name}`)
      }
    }
  }
  // Read only *after* every module above has been dynamically `load()`ed,
  // not before the loop: a module can register its own entries into
  // `MUTATION_REGISTRY` as an import-time side effect (`profiles.ts`
  // does, for `profiles.updateMine`), and that side effect only runs once
  // this test's own `import.meta.glob` loader actually imports the file —
  // which happens *inside* the loop above. Snapshotting `declared` before
  // the loop (as this test used to) reads the registry before any such
  // module has had a chance to register itself, so every mutation's very
  // first-ever registration would be reported as "missing" regardless of
  // whether it's correctly declared.
  const declared = new Set(MUTATION_REGISTRY.map((e) => e.name))
  const missing = publicMutations.filter((name) => !declared.has(name))
  expect(missing).toEqual([])

  // Canari dans l'autre sens : `missing` seul ne prouve que "toute
  // mutation publique est déclarée" (public ⊆ declared) — pas l'inverse.
  // Une entrée orpheline (mutation renommée/supprimée mais laissée dans
  // `MUTATION_REGISTRY`) passerait `missing` silencieusement. Tailles
  // égales + `missing` vide, sur des ensembles finis, entraîne
  // `declared === public` exactement.
  expect(declared.size).toBe(new Set(publicMutations).size)
})

// Canari séparé, delta minimal exprès : si `MUTATION_REGISTRY` retombe à
// zéro (barrel cassé, import supprimé par erreur, régression du genre de
// celle que ce fichier vient de révéler dans `lib/authz.test.ts`), ce
// test échoue *ici*, avec un message qui pointe directement vers la bonne
// cause, plutôt que de laisser `lib/authz.test.ts` générer silencieusement
// zéro test de permission pendant que celui-ci continue de passer.
test("le registre n'est jamais vide dès qu'une mutation s'y déclare (canari anti-régression)", () => {
  expect(MUTATION_REGISTRY.length).toBeGreaterThan(0)
})

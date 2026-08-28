---
name: convex-function
description: Use when adding, changing or reviewing anything under packages/backend/convex/ — a query, a mutation, an action, a schema table, an index, or a test for one. Also use when a test suite fails with "has an argument shape this test doesn't know how to drive", "BETTER_AUTH_SECRET is not set", an empty permission matrix, or a Convex push that succeeds locally but fails against the real deployment.
---

# Écrire une fonction Convex dans AstroTan

Chaque point de cette liste a été payé une fois dans ce dépôt. Ce ne sont pas
des bonnes pratiques générales : ce sont les pannes qu'on a rencontrées.

## Avant d'écrire

**Lire `CLAUDE.md`**, section « Règles du backend Convex ». Le résumé :

- Tout fichier à nom simple sous `convex/` est un **point d'entrée de
  déploiement**. Seuls les noms à deux points (`*.test.ts`) en sont exclus.
  Un helper de test placé là a cassé le déploiement avec
  `TypeError: import.meta unsupported` — tests verts, typecheck propre,
  déploiement refusé. Les helpers vivent dans `packages/backend/testing/`.
- `_generated/` est **régénéré, jamais édité à la main**. Il avait dérivé de
  trois modules avant qu'on s'en aperçoive.
- **Ne jamais lancer `npx convex dev`** en tant qu'agent. Le contrôleur pousse
  et vérifie.

## La liste, dans l'ordre

### 1. Le test d'abord, et son préambule d'environnement

Tout nouveau fichier de test a besoin de ce bloc. Sans lui : `Error:
BETTER_AUTH_SECRET is not set on this Convex deployment`, sur **tous** les
tests du fichier, avant même d'atteindre ton code.

```ts
let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  process.env.BETTER_AUTH_SECRET = "test-secret-please-do-not-use-in-prod-x"
  process.env.SITE_URL = ORIGIN
  process.env.PREVIEW_SECRET = "test-preview-secret-please-do-not-use-in-prod-x"
})

afterEach(() => {
  process.env = originalEnv
})
```

`createAuth` refuse de démarrer sans secret, et c'est voulu — un déploiement
sans `BETTER_AUTH_SECRET` signerait des jetons avec une valeur par défaut
connue.

### 2. Le rôle, dans la fonction

```ts
const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
```

**L'interface masque, elle ne décide pas** (invariant 3 de `CLAUDE.md`).
Cacher un bouton n'est jamais ce qui protège une mutation.

Pour une ressource qui appartient à quelqu'un, ajouter
`requireOwnDocument(authUser, doc)` — owner et admin passent outre, un editor
ne touche que ses propres documents.

### 3. Borner chaque champ texte

`v.string()` de Convex n'a **aucune longueur maximale** : il accepte tout
jusqu'au plafond de 1 Mo par document. Ce dépôt a livré trois fois des champs
non bornés qui atterrissaient dans une interface.

Exporter la constante (l'interface l'importe pour caper son `maxLength`), et
la tester **aux deux bornes** — celle qui passe et celle qui échoue.

Le code d'erreur établi est `FIELD_TOO_LONG` avec `{ field, max }`.

### 4. Déclarer la mutation au registre

**Toute mutation publique** doit être ajoutée à `MUTATION_REGISTRY`, et son
module importé dans `packages/backend/testing/registryModules.ts`.

```ts
MUTATION_REGISTRY.push({
  name: "monModule.maMutation",
  allowedRoles: ["owner", "admin"],
  invoke: (t) => t.mutation(api.monModule.maMutation, { /* … */ }),
})
```

Oublier le barrel est pire qu'oublier le registre : la matrice de permissions
construit ses `test()` **au moment de la collecte**, donc un registre vide ne
génère aucun test — et `_registry.test.ts` passe quand même. Zéro test
exécuté, suite verte.

### 5. Si tu ajoutes une *query* publique

`pages.publicQueryFamily.test.ts` découvre automatiquement toute query
exportée et **refuse** celles dont il ne sait pas fabriquer les arguments :

```
public query media.byStorageId has an argument shape this test doesn't know
how to drive yet: [storageId]. Teach discoverPublicQueries's caller this
shape before trusting this test's coverage of it.
```

Ce n'est pas un bug : c'est le refus d'ignorer en silence. Aller ajouter une
branche pour cette forme dans ce fichier.

Et la règle de fond : **une query publique filtre `status === "published"`
dans la query**, jamais dans l'appelant. `apps/web` n'a ni session ni clé
admin — une query qui oublie ce filtre est une fuite de brouillons sans rien
d'autre en travers.

### 6. Changer le schéma : expand → migrate → contract

Jamais destructif en un seul déploiement (invariant 6). Retirer un champ que
des lignes portent encore fait **rejeter le push**.

1. **expand** — ajouter le nouveau champ en `v.optional(...)`, pousser
2. **migrate** — une `internalMutation` jetable qui remplit puis vide
3. **contract** — rendre obligatoire / retirer l'ancien, pousser

Puis **supprimer la migration** : une fois le champ retiré du schéma, elle ne
compile plus, et la garder impose des casts qui mentent au typage.

### 7. Vérifier pour de vrai

```bash
pnpm --filter @astrotan/backend exec tsc --noEmit
pnpm --filter @astrotan/backend test
```

**`tsc` et vitest ne voient pas ce que le runtime Convex refuse.** Le
contrôleur pousse ensuite et vérifie que la table/fonction existe réellement
sur le déploiement. Une tâche n'est pas finie avant ce push.

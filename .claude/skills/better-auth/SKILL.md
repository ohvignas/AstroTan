---
name: better-auth
description: Use when working on authentication in this repo — Better Auth with Convex (Local Install), roles owner/admin/editor, the admin() plugin, invitations, session handling in TanStack Start, or any change touching packages/backend/convex/auth.ts, convex/betterAuth/, or a permission check. Also use when asked about login, session, role, permission, invitation, "qui a le droit de", or when adding a Convex mutation that writes data.
---

# Better Auth × Convex sur AstroTan

## Toujours faire d'abord

Interroger le serveur MCP `better-auth` (`search_docs` puis `get_doc`). Cette
intégration bouge vite : `@convex-dev/better-auth` suit `better-auth` avec un
décalage de version. **Ne jamais écrire une API Better Auth de mémoire.**

Index local des pages : `docs/ai/better-auth.llms.txt`.

## Montage retenu (spec §5)

**Local Install**, pas l'install composant standard. Raison : le plugin `admin()`
ajoute le champ `role` au schéma généré, ce qui fait de l'utilisateur Better Auth
l'unique source de vérité du rôle. Un `role` dupliqué côté application créerait
deux vérités divergentes.

Fichiers, dans `packages/backend/convex/` :

| Fichier | Rôle |
|---|---|
| `betterAuth/convex.config.ts` | `defineComponent("betterAuth")` |
| `betterAuth/schema.ts` | **généré**, ne pas éditer à la main |
| `betterAuth/auth.ts` | export statique `auth` pour la génération de schéma |
| `betterAuth/adapter.ts` | `createApi(schema, createAuthOptions)` |
| `auth.ts` | `createAuthOptions` + `createAuth` + `authComponent` |
| `auth.config.ts` | `getAuthConfigProvider()` |
| `http.ts` | `authComponent.registerRoutes(http, createAuth)` |

Régénérer le schéma après tout changement de plugin :

```bash
cd packages/backend/convex/betterAuth && npx @better-auth/cli generate
```

`betterAuth/schema.ts` est généré : le modifier à la main le désynchronise de la
config Better Auth. Changer la config, puis régénérer.

## Règles non négociables

**1. Le rôle se lit sur l'utilisateur Better Auth, jamais sur `profiles`.**
`profiles` ne contient aucun champ `role` — s'il en apparaît un, c'est un bug.

**2. Toute mutation et toute query non publique commence par `requireRole`.**

```ts
const authUser = await requireRole(ctx, ["admin", "owner"])
```

L'UI ne fait que masquer, elle ne décide rien. Une mutation ajoutée sans son test de
permission fait échouer la CI (matrice de permissions, spec §8).

**3. Un `editor` n'écrit que ses propres documents.** `requireRole` ne suffit pas :
vérifier aussi `doc.createdBy === authUser._id` sur les écritures de `pages` et
`posts`. Un `editor` ne publie jamais.

**4. L'invariant « owner unique » vit dans `databaseHooks`, pas dans nos mutations.**
Le plugin `admin()` expose ses propres endpoints HTTP (`setRole`, `removeUser`) qui
ne passent pas par le code applicatif. Un garde-fou placé ailleurs que dans
`databaseHooks.user.update.before` / `.delete.before` est contournable. Règles
refusées : promouvoir un second owner, rétrograder ou supprimer le dernier owner,
modifier un owner par un appelant qui n'est pas cet owner.

**5. Pas d'inscription publique.** `signUp` désactivé côté serveur. Entrée par
invitation uniquement : token 32 octets, seul le SHA-256 stocké, expiration 7 jours.

## Côté client (apps/admin)

Utiliser `useConvexAuth()` ou `<Authenticated>` / `<Unauthenticated>` de Convex —
**pas** `getSession()` / `useSession()` de Better Auth. Better Auth considère
l'utilisateur authentifié avant Convex ; une query lancée dans cet intervalle
échoue. Envelopper les queries authentifiées dans `<Authenticated>`.

Le serveur Better Auth tourne dans Convex ; l'admin le proxifie via
`src/routes/api/auth/$.ts`, donc les cookies restent same-origin sur
`admin.exemple.fr`. Si un jour l'admin appelle Convex directement pour l'auth, les
cookies deviennent cross-site et cette hypothèse tombe.

## Tests

`convex-test` + Vitest, environnement `edge-runtime`. Les cas obligatoires sont
listés dans la spec §8 — en particulier : les tests d'owner unique doivent passer
**par les endpoints du plugin `admin()`**, pas seulement par nos mutations, sinon
ils ne testent pas le chemin qu'un attaquant emprunterait.

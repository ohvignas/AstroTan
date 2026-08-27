# Spike Task 1 — résultats au 2026-08-27

## Versions validées (typecheck 0 erreur, build OK)

| Paquet | Version | Note |
|---|---|---|
| `better-auth` | **1.6.17** | EXACT. 1.6.18+ casse le typage de `ConvexBetterAuthProvider`. |
| `@convex-dev/better-auth` | **0.12.5** | EXACT. peer: `>=1.6.11 <1.7.0`. |
| `convex` | 1.45.0 | peer `^1.25.0` |
| `@tanstack/react-start` | 1.168.49 | |
| `react` / `react-dom` | 19.2.8 | |
| `convex-helpers` | 0.1.123 | **dépendance directe obligatoire** |
| `srvx` | 0.12.7 | wrapper serveur de production |

`better-auth@1.7.x` est **hors plage** : aucune version de `@convex-dev/better-auth`
ne la supporte. Le guide officiel recommande `~1.6.15`, qui résout en 1.6.30 —
cassé. Ne pas suivre la plage documentée.

## Points validés sans déploiement Convex

- [x] **5 — champ `role`** : `admin()` génère
  `role: v.optional(v.union(v.null(), v.string()))` sur `user`, plus `banned`,
  `banReason`, `banExpires`, `session.impersonatedBy`,
  `verification.failedVerificationCount`, `verification.lockedUntil`.
- [x] **1 (partiel)** — `tsc --noEmit` : 0 erreur. `vite build` : OK.

## Points restants — nécessitent un déploiement Convex

- [ ] 1 (runtime) `pnpm dev` démarre
- [ ] 2 connexion email + mot de passe
- [ ] 3 session lisible en SSR
- [ ] 4 `authComponent.getAuthUser(ctx)` dans une query
- [ ] 5 (runtime) rôle modifiable via `admin()`
- [ ] Q3 `databaseHooks` intercepte-t-il `admin.setRole` ? (`./probe-q3.sh`)

## Questions ouvertes — réponses

**Q1 — références d'id inter-composant.** Résolu. Liaison officielle :
`authComponent.setUserId(ctx, authUser._id, appUserId)` dans
`triggers.user.onCreate`, relue en `authUser.userId as Id<'users'>`. Stocké en
`string`, casté à la lecture. La spec §4 (`v.string()`) est confirmée.

**Q2 — bundle serveur TanStack Start.** `dist/server/server.js`, client dans
`dist/client/`. **Ce n'est pas un serveur** : il exporte `default = { fetch }`.
`node dist/server/server.js` sort immédiatement sans rien faire. Wrapper validé :

```js
// serve.mjs
import { serve } from "srvx"
import handler from "./dist/server/server.js"
serve({ fetch: handler.fetch, port: Number(process.env.PORT ?? 3000), hostname: "0.0.0.0" })
```

Vérifié : HTTP 200 sur `/sign-in`.

**Q3 — `databaseHooks` vs endpoints du plugin `admin()`.** En attente du
déploiement. Sonde en place dans `convex/auth.ts` (`SONDE_OWNER_BLOCKED`).

## Corrections à porter dans la spec et le plan

1. **§9** — tableau de versions ci-dessus, en exact pour les deux paquets sensibles.
2. **§7 / lot 5** — la commande Docker de l'admin est `node serve.mjs`, pas
   `node dist/server/index.js`. Le wrapper `srvx` fait partie du livrable.
3. **§4 / Task 3** — `convex-helpers` en dépendance directe de `packages/backend`.
   pnpm strict ne hisse pas les transitives ; l'oubli casse la génération de schéma
   avec un `MODULE_NOT_FOUND` opaque.
4. **§5 / Task 5** — `role` est `string | null | undefined`, pas une union de
   littéraux. `requireRole` doit échouer fermé sur `null`/`undefined`, et le cast
   `as Role` doit disparaître au profit d'une validation explicite. Rien au niveau
   base n'empêche `role: "superadmin"`.
5. **Task 4** — la CLI Better Auth est le paquet npm **`auth`** (pas
   `@better-auth/cli`, qui suit une autre ligne de versions et s'arrête à 1.4.21).
   Commande : `pnpm dlx auth@<version-de-better-auth> generate --y`.
6. **Task 4** — `createAuthOptions` doit inclure `database: authComponent.adapter(ctx)`,
   absent de mon brouillon.
7. **Task 7** — la synchronisation profil se fait par `triggers` du composant Convex
   (`triggers.user.onCreate/onUpdate/onDelete` + `authComponent.triggersApi()`), pas
   par une mutation `ensure` maison. Exports requis :
   `export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi()`.

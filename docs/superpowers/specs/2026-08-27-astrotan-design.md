# AstroTan — Template site vitrine + CMS

**Date** : 2026-08-27
**Statut** : design validé, en attente de plan d'implémentation

## 1. Objectif

Template réutilisable pour livrer un site vitrine et son back-office de gestion de
contenu. Première instance : `illith.com` / `admin.illith.com`.

Deux applications, un backend partagé :

| | Site public | Dashboard |
|---|---|---|
| Domaine | `illith.com` | `admin.illith.com` |
| Framework | Astro 7 | TanStack Start 1 |
| Rendu | SSG + SSR sélectif avec cache | SPA/SSR authentifié |
| Auth | **aucune** | Better Auth |
| Accès Convex | `ConvexHttpClient`, queries publiques | `ConvexReactClient`, session |

Backend : Convex cloud (database, functions, storage, realtime). Hébergement des
deux apps : Docker sur VPS Hostinger derrière Traefik.

## 2. Périmètre

**Dans la v1** : pages à blocs, blog, brouillon/publié + preview, médias, SEO par
page + JSON-LD, navigation header/footer, slugs et redirections 301, utilisateurs
et rôles.

**Hors v1** : multilingue, révisions/historique, page-builder drag & drop,
multi-tenant, formulaires de contact, recherche.

## 3. Architecture

```
astrotan/
├─ apps/
│  ├─ web/                 Astro 7 · @astrojs/node standalone
│  │  └─ src/components/blocks/*.astro    ← rendu des blocs, source unique
│  └─ admin/               TanStack Start 1 · React 19 · shadcn/ui
├─ packages/
│  ├─ backend/             Convex : schema, functions, betterAuth/
│  └─ tokens/              tokens Tailwind v4 partagés (@theme)
├─ docker/
└─ .github/workflows/
```

pnpm workspaces + Turborepo. `packages/backend` exporte `api`, `Doc`, `Id` depuis
`convex/_generated`. **Aucun package intermédiaire à builder** : les types viennent
de la codegen Convex (`convex dev` / `convex codegen`), qui doit donc avoir tourné
avant un typecheck à froid — la CI lance `convex codegen` avant `turbo typecheck`.

Pas de `packages/ui` : les composants shadcn n'ont qu'un consommateur (`admin`),
les blocs sont en `.astro`. Seuls les tokens CSS sont partagés.

### Invariant de sécurité central

`apps/web` ne détient ni clé admin Convex ni session. Il n'appelle que des queries
publiques, et chacune filtre `status === "published"` côté serveur. Toute query
publique sans ce filtre est une fuite de brouillons. Testé (§8).

## 4. Modèle de données

Tables applicatives :

| Table | Champs | Index |
|---|---|---|
| `pages` | `slug`, `title`, `status`, `blocks[]`, `seo`, `publishedAt`, `createdBy`, `updatedBy` | `by_slug`, `by_status`, `by_created_by` |
| `posts` | `slug`, `title`, `excerpt`, `coverId`, `blocks[]`, `status`, `publishedAt`, `createdBy`, `updatedBy`, `tagIds[]` | `by_slug`, `by_status_published`, `by_created_by` |
| `tags` | `name`, `slug` | `by_slug` |
| `media` | `storageId`, `filename`, `mime`, `width`, `height`, `alt`, `size` | `by_creation` |
| `navigation` | `key: "header" \| "footer"`, `items[]` (2 niveaux max) | `by_key` |
| `redirects` | `from`, `to`, `code: 301 \| 302`, `enabled` | `by_from` |
| `settings` | singleton : `siteName`, `defaultSeo`, `socials`, `logoId` | — |
| `profiles` | `authUserId: string`, `displayName`, `avatarId` — **sans champ `role`** | `by_auth_user` |
| `invitations` | `email`, `role`, `tokenHash`, `expiresAt`, `invitedBy`, `acceptedAt` | `by_token_hash`, `by_email` |
| `revalidationOutbox` | cf. §6.2 | `by_status_next_attempt` |

`createdBy` et `updatedBy` sont des `v.string()` contenant l'id de l'utilisateur
Better Auth. Ce ne sont pas des `v.id()` : les tables Better Auth vivent dans un
composant, et Convex ne type pas les références inter-composants. La résolution
vers un nom affichable passe par `profiles.by_auth_user`.

Tables Better Auth : dans `convex/betterAuth/schema.ts` (Local Install, §5).

### Blocs

`blocks[]` est un champ embarqué, pas une table. Union discriminée validée par
Convex :

```ts
const block = v.union(
  v.object({ type: v.literal("hero"),     title: v.string(), subtitle: v.optional(v.string()), mediaId: v.optional(v.id("media")), cta: v.optional(ctaValidator) }),
  v.object({ type: v.literal("richText"), html: v.string() }),
  v.object({ type: v.literal("features"), items: v.array(featureValidator) }),
  v.object({ type: v.literal("gallery"),  mediaIds: v.array(v.id("media")) }),
  v.object({ type: v.literal("faq"),      items: v.array(qaValidator) }),
  v.object({ type: v.literal("cta"),      title: v.string(), cta: ctaValidator }),
)
```

Justification : réordonner = une mutation atomique, pas de N+1 au rendu, et le type
se propage jusqu'au composant `.astro` via un registre
`Record<Block["type"], AstroComponent>` exhaustif — ajouter un type de bloc sans son
composant devient une erreur TypeScript. Limite : 1 Mo par document Convex.

Pas de révisions en v1 : `draft` / `published` suffit à la boucle demandée.

## 5. Authentification et rôles

### Montage — Local Install

`@convex-dev/better-auth` en **Local Install** : les tables Better Auth sont
générées par CLI dans `packages/backend/convex/betterAuth/schema.ts` et
appartiennent au projet. Raison : le plugin `admin()` ajoute le champ `role` au
schéma généré, ce qui fait de l'utilisateur Better Auth **l'unique source de vérité
du rôle**. Un champ `role` dupliqué côté application créerait deux vérités
divergentes.

Fichiers : `convex.config.ts`, `auth.config.ts` (`getAuthConfigProvider()`),
`auth.ts` (instance + plugins `convex()` et `admin()`), `http.ts`
(`authComponent.registerRoutes`), `betterAuth/schema.ts` (généré).
Côté admin : `auth-client.ts` (plugin `convexClient()`), `auth-server.ts`
(`convexBetterAuthReactStart()`), route proxy `src/routes/api/auth/$.ts`.

Le serveur Better Auth tourne dans Convex ; l'admin le proxifie, donc les cookies
de session restent same-origin sur `admin.illith.com`. Aucun cookie cross-site.

`profiles` ne porte que des champs applicatifs (`displayName`, `avatarId`) et
**jamais** le rôle. Le typage exact des références d'id à travers la frontière du
composant local est à confirmer pendant le spike (§9).

### Rôles

Trois rôles définis via `createAccessControl()` :

| | pages/posts | publier | médias | navigation · redirections · settings | utilisateurs |
|---|---|---|---|---|---|
| `editor` | CRUD si `createdBy` = lui, lecture des autres | ✗ | upload | lecture | ✗ |
| `admin` | CRUD tout | ✓ | CRUD | CRUD | inviter/éditer `editor` |
| `owner` | CRUD tout | ✓ | CRUD | CRUD | tout, y compris `admin` |

### Application des permissions

Deux niveaux, tous deux côté serveur. **L'UI ne fait que masquer, elle ne décide
rien.**

**Niveau 1 — mutations applicatives.** Chaque mutation et chaque query non publique
commence par :

```ts
export async function requireRole(ctx, roles: Role[]) {
  const authUser = await authComponent.getAuthUser(ctx)      // valide la session
  if (!authUser) throw new ConvexError({ code: "UNAUTHENTICATED" })
  if (!roles.includes(authUser.role)) throw new ConvexError({ code: "FORBIDDEN" })
  return authUser
}
```

Le rôle est lu sur l'utilisateur Better Auth, jamais sur `profiles`.

Pour un `editor`, `requireRole` ne suffit pas : les mutations d'écriture sur
`pages` et `posts` vérifient en plus `doc.createdBy === authUser._id`. Un `editor`
peut lire tous les brouillons mais n'écrit que les siens, et ne publie jamais.

**Niveau 2 — invariant « owner unique ».** Le plugin `admin()` expose ses propres
endpoints HTTP (`setRole`, `removeUser`) qui ne passent pas par nos mutations. Un
garde-fou placé uniquement dans le code applicatif serait donc contournable.
L'invariant est implémenté dans `databaseHooks.user.update.before` et
`databaseHooks.user.delete.before` de la config Better Auth — le seul point que
tous les chemins d'écriture traversent. Règles refusées :

1. promouvoir un second `owner` ;
2. rétrograder ou supprimer le dernier `owner` ;
3. modifier un `owner` par un appelant qui n'est pas cet `owner`.

### Accès au dashboard

Pas d'inscription publique : `emailAndPassword` activé, `signUp` désactivé côté
serveur. Entrée uniquement par invitation : token aléatoire de 32 octets dont seul
le SHA-256 est stocké, expiration 7 jours, email via `@convex-dev/resend`, lien
`/accept-invite?token=…` qui crée le compte et consomme l'invitation. Better Auth
ne fournit pas d'invitation hors plugin `organization` ; on l'écrit.

## 6. Rendu, cache et publication

### 6.1 Configuration Astro

```js
export default defineConfig({
  output: 'static',
  adapter: node({ mode: 'standalone' }),   // @astrojs/node
  cache: { provider: memoryCache() },
  routeRules: {
    '/blog':           { maxAge: 300, swr: 600, tags: ['posts'] },
    '/blog/[...slug]': { maxAge: 300, swr: 600, tags: ['posts'] },
    '/[...slug]':      { maxAge: 300, swr: 600, tags: ['pages'] },
  },
})
```

`@astrojs/node` en mode `standalone` sert les fichiers prérendus **et** exécute les
routes on-demand dans le même conteneur.

| Route | Rendu | Tags |
|---|---|---|
| pages légales, 404, assets | `prerender = true` | — |
| `/[...slug]` (pages CMS) | `prerender = false` | `pages`, `page:{slug}` |
| `/blog`, `/blog/[slug]` | `prerender = false` | `posts`, `post:{slug}` |
| `/sitemap.xml` | `prerender = false` | `pages`, `posts` |
| `/preview/…` | `prerender = false` | cache désactivé dans la route |
| `/api/revalidate` | `prerender = false` | cache désactivé dans la route |

Les routes non cachables appellent `Astro.cache.set(false)` (pages) ou
`context.cache.set(false)` (endpoints) **dans la route**, et non via une entrée
`routeRules` — l'opt-out documenté est l'appel explicite.

### 6.2 Boucle de publication — outbox durable

Les scheduled actions Convex ne sont pas retentées automatiquement. Une invalidation
perdue laisse une page publiée invisible jusqu'à expiration du `maxAge`. La
publication utilise donc un outbox transactionnel.

`revalidationOutbox` : `tags: string[]`, `status: "pending" | "done" | "failed"`,
`attempts: number`, `nextAttemptAt: number`, `lastError?: string`, `createdAt`.
Index `by_status_next_attempt`.

1. `publishPage` écrit `status`/`publishedAt` **et** insère la ligne d'outbox dans
   la même mutation — atomique, la ligne ne peut pas manquer.
2. La mutation planifie `internal.revalidate.drain` immédiatement (chemin rapide).
3. `drain` réclame les lignes `pending` dont `nextAttemptAt <= now`, POSTe sur
   `${SITE_URL}/api/revalidate`, puis marque `done`, ou incrémente `attempts` avec
   backoff exponentiel (1 s, 5 s, 25 s, 2 min, 10 min) ; au-delà de 6 tentatives,
   `failed`.
4. Un cron `crons.interval("revalidate-sweep", { seconds: 60 }, internal.revalidate.drain)`
   rattrape toute action perdue.
5. Le dashboard affiche l'état de publication depuis l'outbox : « publiée »,
   « propagation en cours », « échec ». C'est la raison de préférer un outbox
   applicatif à `@convex-dev/action-retrier` seul : le retrier gère la reprise mais
   ne donne pas d'état observable dans l'UI.

`/api/revalidate` (Astro) : POST uniquement, compare `x-revalidate-secret` en temps
constant, appelle `context.cache.invalidate({ tags })`, répond 200. Le secret ne
transite jamais côté client.

**Dette assumée** : `memoryCache()` est par processus, l'invalidation ne touche
qu'une instance. La v1 tourne à **un seul réplica** de `web`. Passer à N réplicas
imposera un provider partagé (Redis via la Cache Provider API).

### 6.3 Preview — deux barrières indépendantes

1. Le dashboard demande un token à une action Convex : HMAC-SHA256 de
   `{type}:{id}:{exp}` avec `PREVIEW_SECRET`, expiration 15 minutes. Ouvre
   `https://illith.com/preview/{type}/{id}?t={token}`.
2. Astro vérifie HMAC et expiration avant tout appel réseau.
3. Astro appelle `previewPage({ id, token })` — **famille de fonctions distincte**
   des queries publiques — qui **revérifie le HMAC côté Convex**.
4. Les queries publiques (`getPublishedPage`, `listPublishedPosts`, …) n'acceptent
   aucun token et filtrent `status === "published"` en dur : elles ne peuvent pas
   servir un brouillon, même appelées avec un id de brouillon.
5. Réponse en `Cache-Control: no-store` et `X-Robots-Tag: noindex`.

### 6.4 Slugs et redirections

Slug unique vérifié par index dans la mutation. **Changer un slug crée
automatiquement une redirection 301** de l'ancien vers le nouveau, dans la même
mutation.

Le middleware Astro consulte `redirects` (mémoïsé 60 s, tag `redirects`) et répond
`Response.redirect(to, code)`.

Limite : le middleware ne s'exécute pas pour les routes prérendues, servies
directement en statique. La mutation **refuse** donc toute redirection dont le
`from` correspond à un chemin prérendu au build — la contrainte est bloquée à la
saisie plutôt que découverte en production.

### 6.5 Navigation et SEO

`navigation` (header/footer, 2 niveaux) lu dans le layout, tag `navigation`. Champs
SEO par page (`title`, `description`, `ogImage`, `canonical`, `noindex`), JSON-LD
`Organization` global et `Article` sur les posts, `sitemap.xml` généré depuis
Convex, `robots.txt` statique.

## 7. Déploiement

### Images

`node:22-alpine`, corepack + pnpm, multi-stage avec `pnpm deploy --filter` pour un
runtime minimal, utilisateur non-root.

- `web` → `node ./dist/server/entry.mjs`, port 4321. `PUBLIC_CONVEX_URL` passé en
  **build-arg** : les pages prérendues lisent Convex au build.
- `admin` → serveur Node de TanStack Start, port 3000. Le chemin exact du bundle
  serveur dépend du preset et sera confirmé au premier build (§9).

`docker-compose.yml` : Traefik v3 (80/443, résolveur ACME Let's Encrypt), `web` sur
`Host(illith.com)`, `admin` sur `Host(admin.illith.com)`, réseau interne,
`restart: unless-stopped`, healthchecks HTTP. Pas de conteneur base de données.

### Pipeline

`.github/workflows/deploy.yml`, sur push `main`, séquentiel :

1. `npx convex deploy` (`CONVEX_DEPLOY_KEY`) — le schéma doit précéder le build
   d'Astro, qui interroge Convex.
2. Build et push des deux images sur `ghcr.io`, taguées `:{sha}` et `:latest`.
3. SSH sur le VPS : `docker compose pull && docker compose up -d && docker image prune -f`.

Secrets : `CONVEX_DEPLOY_KEY`, `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`,
`PUBLIC_CONVEX_URL`.

`REVALIDATE_SECRET` et `PREVIEW_SECRET` sont partagés entre le déploiement Convex et
le conteneur `web`, générés une fois (`openssl rand -hex 32`), stockés dans les
secrets GitHub et via `npx convex env set`. Ils ne transitent jamais côté client.

### Rollback et migrations

**Un rollback d'image Docker ne rollback pas Convex.** `convex deploy` remplace les
functions et le schéma du déploiement ; repointer `compose` sur un tag d'image
antérieur laisserait un frontend ancien face à un backend neuf.

Discipline **expand / migrate / contract**, obligatoire sur tout changement de
schéma :

1. **expand** — ajouter le champ en `v.optional()`, écrire l'ancien et le nouveau,
   lire l'ancien en priorité. Déployable seul, compatible avec le code précédent.
2. **migrate** — backfill via `@convex-dev/migrations`, sans changement de schéma.
3. **contract** — retirer l'ancien champ, uniquement après que les images qui le
   lisaient sont hors rotation.

Chaque étape est un déploiement distinct. Conséquence : **un rollback d'un cran
arrière est toujours sûr**, puisqu'aucun déploiement ne rend le précédent
incompatible.

Procédure de rollback : rejouer **le pipeline complet** sur le tag git précédent
(`convex deploy` des anciennes functions + anciennes images), via un workflow
`rollback.yml` en `workflow_dispatch` prenant un sha. Ne jamais rollback les images
seules. Le job de déploiement enregistre le sha publié pour rendre la cible
évidente.

La validation de schéma de Convex refuse un déploiement incohérent avec les données
existantes : une phase *contract* lancée sur un backfill incomplet échoue bruyamment
plutôt que de corrompre.

## 8. Tests

**Backend Convex** (`convex-test` + Vitest) — l'essentiel de l'effort, parce que
c'est là qu'est la sécurité :

- **Matrice de permissions** : chaque rôle × chaque mutation. Un test générique
  itère sur un registre des mutations ; ajouter une mutation sans l'y déclarer fait
  échouer la CI.
- **Invariant « jamais de brouillon en public »** : pour chaque query publique,
  créer un document `draft` et vérifier que le retour est vide ou `null`. Test
  paramétré sur la liste des queries publiques.
- **Owner unique** : promotion d'un second owner, rétrogradation du dernier owner,
  suppression du dernier owner, modification d'un owner par un admin — tous refusés,
  **testés par les endpoints du plugin `admin()`** et pas seulement par nos
  mutations.
- **Preview** : token expiré rejeté ; token altéré d'un octet rejeté ; token d'une
  page A réutilisé sur une page B rejeté.
- **Outbox** : échec HTTP → `attempts` incrémenté et `nextAttemptAt` repoussé ;
  6 échecs → `failed` ; le cron reprend une ligne dont l'action planifiée a été
  perdue.
- Unicité des slugs, création automatique du 301 au changement de slug, refus d'une
  redirection sur un chemin prérendu.

**apps/web** : `astro check` en CI, plus un test d'exhaustivité du registre de blocs
(tout `Block["type"]` a un composant `.astro`, vérifié au type et au runtime).

**E2E Playwright** contre la stack `docker compose` en CI : connexion → création de
page → ajout et réordonnancement de blocs → preview, en vérifiant que l'URL publique
renvoie encore 404 → publication → page en ligne en moins de 5 secondes.

## 9. Versions — à figer après validation

Les versions ci-dessous sont **candidates**, relevées le 2026-08-27. Elles ne sont
pas épinglées tant que le spike d'intégration (première tâche du plan) n'a pas validé
la combinaison TanStack Start / SSR / Better Auth / Convex de bout en bout :
connexion, session en SSR, `getAuthUser` dans une query, rôle lu par `requireRole`.

| Paquet | Candidate |
|---|---|
| `astro` | 7.2.8 |
| `@astrojs/node` | 11.1.4 |
| `@astrojs/react` | 6.0.4 |
| `@tanstack/react-start` | 1.168.49 |
| `convex` | 1.45.0 |
| `better-auth` | 1.7.2 |
| `@convex-dev/better-auth` | 0.12.5 |
| `@convex-dev/migrations` | 0.3.6 |
| `@convex-dev/resend` | 0.2.7 |
| `tailwindcss` | 4.3.3 |

Le couple `better-auth` / `@convex-dev/better-auth` est le plus sensible : le second
suit le premier avec un décalage. Une fois le spike vert, les deux sont épinglés en
version exacte (sans `^`) et le lockfile fait foi.

Points à confirmer pendant le spike :

1. Typage des références d'id à travers la frontière du composant Better Auth local.
2. Chemin du bundle serveur de TanStack Start (`.output/server/index.mjs` ou
   `dist/server/index.js`) selon le preset.
3. Comportement de `databaseHooks` sur les endpoints du plugin `admin()`.

## 10. Découpage en lots

1. **Socle** — monorepo, Convex, Better Auth Local Install, rôles, invitations.
2. **Pages** — schéma des blocs, éditeur, rendu Astro, preview, cache, publication.
3. **Blog** — posts, tags, médias, SEO, JSON-LD, sitemap.
4. **Navigation et redirections** — header/footer, slugs, 301.
5. **Infra** — Docker, Traefik, CI/CD, rollback.

Ce document est la référence d'architecture **commune aux cinq lots** : schéma,
invariants de sécurité, cache, déploiement. Chaque lot reçoit ensuite son propre
plan d'implémentation, qui s'y réfère sans le dupliquer. Le lot 1 est le seul à
planifier maintenant ; les suivants seront planifiés à son achèvement, avec ce que
le spike aura appris.

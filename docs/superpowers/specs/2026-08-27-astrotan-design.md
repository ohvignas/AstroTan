# AstroTan — Template site vitrine + CMS

**Date** : 2026-08-27
**Statut** : design validé, en attente de plan d'implémentation

## 1. Objectif

Template réutilisable pour livrer un site vitrine et son back-office de gestion de
contenu. Le template n'a pas d'instance canonique : chaque adoptant pointe ses propres domaines.

Deux applications, un backend partagé :

| | Site public | Dashboard |
|---|---|---|
| Domaine (exemples) | `exemple.fr` | `admin.exemple.fr` |
| Framework | Astro 7 | TanStack Start 1 |
| Rendu | SSG + SSR sélectif avec cache | SPA/SSR authentifié |
| Auth | **aucune** | Better Auth |
| Accès Convex | `ConvexHttpClient`, queries publiques | `ConvexReactClient`, session |

Backend : Convex cloud (database, functions, storage, realtime). Hébergement des
deux apps : Docker sur VPS Hostinger derrière Traefik.

## 2. Périmètre

**Dans la v1** : pages en Markdown avec leurs réglages SEO/GEO, blog,
brouillon/publié + preview, médias, JSON-LD, navigation header/footer en code, slugs et
redirections 301, utilisateurs et rôles, statistiques par page (Umami).

**Hors v1** : multilingue, révisions/historique, page-builder drag & drop,
multi-tenant, formulaires de contact, recherche.

## 3. Architecture

```
astrotan/
├─ apps/
│  ├─ web/                 Astro 7 · @astrojs/node standalone
│  │  └─ src/lib/markdown.ts              ← rendu Markdown + assainissement
│  └─ admin/               TanStack Start 1 · React 19 · shadcn/ui
├─ packages/
│  ├─ backend/             Convex : schema, functions, betterAuth/
│  └─ tokens/              tokens Tailwind v4 partagés (@theme)
├─ docker/
└─ .github/workflows/
```

pnpm workspaces + Turborepo. `packages/backend` déclare `convex-helpers` en
**dépendance directe** — c'est une transitive de `@convex-dev/better-auth`, et pnpm
strict ne la hisse pas ; son absence casse la génération de schéma Better Auth avec
un `MODULE_NOT_FOUND` opaque. `packages/backend` exporte `api`, `Doc`, `Id` depuis
`convex/_generated`. **Aucun package intermédiaire à builder** : les types viennent
de la codegen Convex (`convex dev` / `convex codegen`), qui doit donc avoir tourné
avant un typecheck à froid — la CI lance `convex codegen` avant `turbo typecheck`.

Pas de `packages/ui` : les composants shadcn n'ont qu'un consommateur (`admin`),
et la mise en page publique est en `.astro`. Seuls les tokens CSS sont partagés.

### Invariant de sécurité central

`apps/web` ne détient ni clé admin Convex ni session. Il n'appelle que des queries
publiques, et chacune filtre `status === "published"` côté serveur. Toute query
publique sans ce filtre est une fuite de brouillons. Testé (§8).

## 4. Modèle de données

Tables applicatives :

| Table | Champs | Index |
|---|---|---|
| `pages` | `slug`, `title`, `status`, `seo`, `geo`, `publishedAt`, `createdBy`, `updatedBy` — **aucun champ de contenu** | `by_slug`, `by_status`, `by_created_by` |
| `posts` | `slug`, `title`, `excerpt`, `coverId`, `body` (Markdown), `status`, `seo`, `geo`, `publishedAt`, `createdBy`, `updatedBy`, `tagIds[]` | `by_slug`, `by_status_published`, `by_created_by` |
| `tags` | `name`, `slug` | `by_slug` |
| `media` | `storageId`, `filename`, `mime`, `width`, `height`, `alt`, `size` | `by_creation` |
| `redirects` | `from`, `to`, `code: 301 \| 302`, `enabled` | `by_from` |
| `settings` | singleton : `siteName`, `defaultSeo`, `socials`, `logoId` | — |
| `profiles` | `authUserId: string`, `displayName`, `avatarId` — **sans champ `role`** | `by_auth_user` |
| `invitations` | `email`, `role`, `tokenHash`, `expiresAt`, `invitedBy`, `acceptedAt` | `by_token_hash`, `by_email` |
| `revalidationOutbox` | cf. §6.2 | `by_status_next_attempt` |

`navigation` : retirée au lot 4 — le menu n'est plus une table CMS.

`createdBy` et `updatedBy` sont des `v.string()` contenant l'id de l'utilisateur
Better Auth. Ce ne sont pas des `v.id()` : les tables Better Auth vivent dans un
composant, et Convex ne type pas les références inter-composants. La résolution
vers un nom affichable passe par `profiles.by_auth_user`.

Tables Better Auth : dans `convex/betterAuth/schema.ts` (Local Install, §5).

### Contenu : rien en base

**Révisé deux fois — le 2026-08-28.** La spec d'origine décrivait `blocks[]`,
une union discriminée de six types rendus par un registre exhaustif. Le lot 2
l'a livrée. Elle a été remplacée par un corps Markdown, puis par des champs de
texte déclarés, puis par rien du tout. Les trois révisions ont convergé vers la
même conclusion, chacune plus tôt que la précédente.

**Une page *est* son fichier `.astro`** : le balisage, la mise en page et les
mots, écrits en code depuis une maquette. La table `pages` ne porte aucun champ
de contenu.

La raison n'est pas technique — les trois modèles fonctionnaient. C'est que
chacun était une seconde façon, plus faible, de faire un travail que le code
fait déjà, et qu'ils entraient en conflit avec lui dès que les deux n'étaient
pas d'accord sur la mise en page. Ce template est destiné à des sites dont le
design est écrit par un agent à partir d'une maquette ; un éditeur de contenu
dans l'admin se bat contre cet agent.

Ce que porte la ligne, c'est ce que le tableau de bord a le droit de décider :

| Question | Répondue par |
|---|---|
| Cette page est-elle en ligne ? | l'admin (`status`) |
| Sur quel chemin répond-elle ? | l'admin (`slug`) |
| Qui doit la trouver ? | l'admin (`seo`, `geo`) |
| Que contient-elle, et à quoi ressemble-t-elle ? | le code (`src/pages/<slug>.astro`) |

Ajouter une page, c'est écrire son fichier. Les trois lignes de passe-partout
sont dans `CLAUDE.md`. `loadPage()` récupère la ligne et pose le statut et le
cache ; `PageHead` rend les champs SEO/GEO dans le `<head>`. Il n'y a rien
d'autre à brancher.

**Aperçu.** Le jeton signe le *slug*, pas l'identifiant du document, si bien
qu'un aperçu s'ouvre à la vraie URL de la page (`/accueil?t=…`). Ce qu'un
éditeur contrôle avant publication est donc littéralement la page qui partira
en ligne — même fichier, même balisage, seule la barrière de publication est
levée. Les deux vérifications indépendantes du jeton sont conservées
(invariant 2).

**Les articles de blog font exception** : un article *est* du contenu, et
personne ne demandera à un agent d'écrire chaque billet. `posts` garde donc un
corps Markdown, rendu par `apps/web/src/lib/markdown.ts` — assaini après
rendu, jamais avant.

### Champs GEO

`geo` est le pendant de `seo` pour les moteurs de réponse. Chaque champ
existe parce qu'une machine le consomme réellement :

| Champ | Consommé par |
|---|---|
| `summary` | l'extrait qu'un moteur de réponse cite tel quel ; alimente `llms.txt` |
| `faq[]` | émis en JSON-LD `FAQPage`, le format le plus fidèlement repris |
| `entities[]` | lève l'ambiguïté de nom (« Mercure » la planète ou l'élément) |
| `noai` | distinct de `seo.noindex` : une page peut être indexable sans que son contenu doive être reproduit |

La migration `convex/migrations.ts` (`blocksToMarkdown`) a converti les
lignes existantes selon le cycle expand/migrate/contract de `CLAUDE.md`,
avant que `body` ne devienne obligatoire et que `blocks` ne quitte le
schéma. Conversion volontairement avec perte : les blocs portaient une
intention de mise en page que le Markdown ne sait pas exprimer, et c'est
précisément ce que le pivot déplace vers le code. Le *texte* est préservé
intégralement ; les images de galerie deviennent une note visible plutôt
qu'une suppression silencieuse.

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
de session restent same-origin sur le domaine de l'admin (ex. `admin.exemple.fr`). Aucun cookie cross-site.

`profiles` ne porte que des champs applicatifs (`displayName`, `avatarId`) et
**jamais** le rôle. Le typage exact des références d'id à travers la frontière du
composant local est à confirmer pendant le spike (§9).

### Rôles

Trois rôles définis via `createAccessControl()` :

| | pages/posts | publier | médias | redirections · settings | utilisateurs |
|---|---|---|---|---|---|
| `editor` | CRUD si `createdBy` = lui, lecture des autres | ✗ | upload | lecture | ✗ |
| `admin` | CRUD tout | ✓ | CRUD | CRUD | inviter/éditer `editor` |
| `owner` | CRUD tout | ✓ | CRUD | CRUD | tout, y compris `admin` |

La table `navigation` a été retirée au lot 4 : header et footer vivent dans le balisage, en code.

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
   `${WEB_SITE_URL}/api/revalidate`, puis marque `done`, ou incrémente `attempts` avec
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
   `https://exemple.fr/<slug>?t={token}`.
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

Header et footer sont du balisage dans `Header.astro` / `Footer.astro` / `config/nav.ts`. Pas de table `navigation`. Champs
SEO par page (`title`, `description`, `ogImage`, `canonical`, `noindex`), JSON-LD
`Organization` global et `Article` sur les posts, `sitemap.xml` généré depuis
Convex, `robots.txt` statique.

## 7. Déploiement

### Images

`node:22-alpine`, corepack + pnpm, multi-stage avec `pnpm deploy --filter` pour un
runtime minimal, utilisateur non-root.

- `web` → `node ./dist/server/entry.mjs`, port 4321. `PUBLIC_CONVEX_URL` passé en
  **build-arg** : les pages prérendues lisent Convex au build.
- `admin` → `node serve.mjs`, port 3000. Le build produit `dist/server/server.js`
  (handler `fetch`, **pas** un serveur) et `dist/client/` ; `serve.mjs` est le
  wrapper `srvx` donné en §9. L'image doit embarquer les deux répertoires et le
  wrapper.

`docker-compose.yml` : Traefik v3 (80/443, résolveur ACME Let's Encrypt), `web` sur
`Host(<WEB_DOMAIN>)`, `admin` sur `Host(<ADMIN_DOMAIN>)`, réseau interne,
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

**`SITE_URL` est l'origine de l'ADMIN** — c'est le `baseURL` de Better Auth. L'origine
du site public est **`WEB_SITE_URL`**, une variable distincte. Les confondre ferait
silencieusement mal router soit l'authentification, soit la revalidation ; la spec
disait initialement `${SITE_URL}/api/revalidate`, ce qui était faux.

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

**apps/web** : `astro check` en CI, plus la suite d'assainissement de
`src/lib/markdown.ts` — chaque cas y est du balisage qui atteindrait un visiteur
en HTML brut si l'assainisseur était retiré ou appliqué avant le rendu.

**E2E Playwright** contre la stack `docker compose` en CI : connexion → création de
page → rédaction du contenu → preview, en vérifiant que l'URL publique renvoie
encore 404 → publication → page en ligne en moins de 5 secondes.

## 9. Versions — figées par le spike du 2026-08-27

Combinaison validée de bout en bout : `tsc --noEmit` à 0 erreur, `vite build` OK,
connexion, session SSR, lecture du rôle depuis une query Convex.

| Paquet | Version | Contrainte |
|---|---|---|
| `astro` | 7.2.8 | |
| `@astrojs/node` | 11.1.4 | |
| `@astrojs/react` | 6.0.4 | |
| `@tanstack/react-start` | 1.168.49 | |
| `convex` | 1.45.0 | peer `^1.25.0` |
| `better-auth` | **1.6.17 (exact)** | voir ci-dessous |
| `@convex-dev/better-auth` | **0.12.5 (exact)** | peer `better-auth >=1.6.11 <1.7.0` |
| `convex-helpers` | 0.1.123 | **dépendance directe obligatoire** |
| `srvx` | 0.12.7 | wrapper serveur du dashboard |
| `@convex-dev/migrations` | 0.3.6 | |
| `@convex-dev/resend` | 0.2.7 | |
| `tailwindcss` | 4.3.3 | |
| `react` / `react-dom` | 19.2.8 | |

**`better-auth` est épinglé en 1.6.17, sans `^` ni `~`.** À partir de 1.6.18, le
typage de `ConvexBetterAuthProvider` casse (`TS2322` sur la prop `authClient`),
indépendamment des plugins déclarés — l'erreur apparaît même avec un client sans
aucun plugin. La 1.7.x est hors de la plage de peer dependencies : aucune version
de `@convex-dev/better-auth` ne la supporte.

Le guide officiel recommande `better-auth@~1.6.15`, ce qui résout aujourd'hui en
1.6.30 et **produit une base cassée**. Ne pas suivre cette plage.

Vérification à refaire avant toute montée de version : `pnpm typecheck` doit
rendre 0 erreur.

### Réponses aux questions du spike

**Références d'id à travers la frontière du composant.** Stockées en `v.string()`,
comme prévu. Liaison officielle par `authComponent.setUserId(ctx, authUser._id,
appUserId)` dans `triggers.user.onCreate`, relue en `authUser.userId as Id<'users'>`.
Convex ne type pas les références inter-composants ; `v.id()` est impossible ici.

**Bundle serveur de TanStack Start.** `dist/server/server.js`, assets client dans
`dist/client/`. **Ce n'est pas un serveur** : il exporte `default = { fetch }`.
`node dist/server/server.js` sort immédiatement sans écouter. Un wrapper est requis :

```js
// serve.mjs — livrable du lot 5
import { serve } from "srvx"
import handler from "./dist/server/server.js"
serve({ fetch: handler.fetch, port: Number(process.env.PORT ?? 3000), hostname: "0.0.0.0" })
```

Vérifié : HTTP 200 sur `/sign-in`.

**`databaseHooks` face aux endpoints du plugin `admin()`.** **Confirmé.** Mesuré sur
un déploiement réel :

- un `update-user` ordinaire déclenche `databaseHooks.user.update.before` ;
- un appel HTTP direct à `/api/auth/admin/set-role` avec `role: "owner"` déclenche
  le hook, l'exception remonte, et **le rôle n'est pas écrit** ;
- un changement légitime (`user` → `editor`) par le même endpoint passe.

L'ancrage de §5 est donc correct : c'est bien le seul point que tous les chemins
d'écriture traversent. À noter, défense en profondeur gratuite : le plugin `admin()`
filtre déjà ses propres endpoints par rôle, et accepte une option `adminUserIds`
qui court-circuite ce filtre — **ne jamais l'utiliser en production**.

L'erreur remonte en 500 avec un corps vide : les tests doivent asserter sur l'état
final (le rôle inchangé), pas sur le contenu de la réponse.

## 10. Découpage en lots

1. **Socle** — monorepo, Convex, Better Auth Local Install, rôles, invitations. *(livré)*
2. **Pages** — registre des pages, publication, aperçu, cache, panneaux SEO/GEO. *(livré ; les trois modèles de contenu essayés ont tous été retirés — voir §4)*
3. **Blog** — posts, tags, médias. *(livré)*
4. **Redirections** — slugs, 301, garde d'exclusion mutuelle. *(backend et middleware livrés ; écran d'admin en cours. La navigation en base est retirée du périmètre : menu et pied de page vivent dans le balisage de chaque page, en code)*
5. **Infra** — Docker, Traefik, CI/CD, rollback. *(livré ; le pipeline n'a jamais tourné contre un vrai VPS)*
6. **SEO, GEO et statistiques** — JSON-LD (`Organization`, `Article`, `FAQPage`), `sitemap.xml`, `robots.txt`, `llms.txt`, et intégration [Umami](https://umami.is/) : script sur le site, lecture de son API dans l'admin pour afficher les statistiques par page. *(plan écrit : `docs/superpowers/plans/2026-08-28-lot6-seo-geo-umami.md`)*

Les lots 3 à 6 sont numérotés dans l'ordre où ils ont été planifiés, pas
dans un ordre d'exécution imposé : 4 et 5 ne dépendent pas de 3, et
plusieurs peuvent avancer en parallèle. Le lot 6 dépend en revanche des
champs `geo` livrés avec le lot 2.

Ce document est la référence d'architecture **commune à tous les lots** : schéma,
invariants de sécurité, cache, déploiement. Chaque lot reçoit ensuite son propre
plan d'implémentation, qui s'y réfère sans le dupliquer. Le lot 1 est le seul à
planifier maintenant ; les suivants seront planifiés à son achèvement, avec ce que
le spike aura appris.

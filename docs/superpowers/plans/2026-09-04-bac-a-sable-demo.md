# Bac à sable démo — plan d’implémentation

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un bouton « Tester » ouvre le vrai dashboard sur un editor bridé, IA à modèle verrouillé, le reste en bac à sable, reset à l’heure.

**Architecture:** Flag Convex `DEMO_SANDBOX` (inerte sur un clone). Entrée par route serveur admin qui échange un secret contre les credentials du compte démo, puis sign-in Better Auth same-origin. Helpers `estCompteDemo` / `exigerPasDemo` dans chaque mutation sensible. Modèle IA lu depuis `DEMO_OPENROUTER_MODEL`. Cron `demo.restaurer`.

**Tech Stack:** Convex (query / action / internalMutation / cron), Better Auth déjà en place, rate-limiter Convex, TanStack Start (route serveur), Astro (bouton conditionnel).

**Spec:** [`docs/superpowers/specs/2026-09-04-bac-a-sable-demo-design.md`](../specs/2026-09-04-bac-a-sable-demo-design.md)

**Skills:** `@convex-function` `@better-auth` `@add-page` (bouton, pas une page)

---

## Fichiers

| Fichier | Responsabilité |
|---|---|
| `packages/backend/convex/lib/demoSandbox.ts` | Flag, e-mail démo, `estCompteDemo`, `exigerPasDemo`, `modeleSandbox`. |
| `packages/backend/convex/lib/demoSandbox.test.ts` | Décisions pures (pas de réseau). |
| `packages/backend/convex/demo.ts` | `ouvert`, `credentials`, `seedSandbox`, `restaurer`, `jeSuisDemo`. |
| `packages/backend/convex/demo.test.ts` | Flag, secret, restore, matrice demo. |
| `packages/backend/convex/lib/openRouterModels.ts` | **Ne pas** envelopper : un slug hors liste retombe sur le défaut. Les call sites passent par `modeleEffectif`. |
| `packages/backend/convex/crons.ts` | Intervalle horaire `demo-restore`. |
| `packages/backend/.env.example` | Documenter les 5 variables. |
| `packages/backend/convex/settings.ts` | `environment.demoSandbox` ; refuser `openRouter*` si flag. |
| Mutations listées §6 de la spec | Appel `exigerPasDemo`. |
| `packages/backend/convex/auth.ts` | Hook `/change-password` (et reset) refuse le compte démo. |
| `packages/backend/convex/ai.ts` | `modeleEffectif` + quota 15/h (clé userId démo). |
| `packages/backend/convex/media.ts` | Quota 10 fichiers **ou** 20 Mo au `register`. |
| `apps/admin/src/routes/demo-enter.tsx` | Route serveur : credentials → sign-in → `/`. |
| `apps/admin/src/lib/demoEnter.ts` | Logique pure extraite (testable). |
| `apps/admin/src/components/demo-banner.tsx` | Bandeau si compte démo. |
| `apps/admin/src/routes/_authed/compte.tsx` | Masquer le changement de mot de passe si `jeSuisDemo`. |
| `apps/admin/src/routes/_authed/settings/agent.tsx` | Masquer les sélecteurs modèle si `environment.demoSandbox`. |
| `apps/web/src/pages/index.astro` | Bouton + phrase bac à sable si `demo.ouvert`. |
| `apps/web/src/lib/demoOuvert.ts` | Query publique côté Astro. |
| `docker/.env.example` | `DEMO_ENTER_SECRET` côté admin (runtime, pas `VITE_*`). |
| `docker/docker-compose.yml` | `DEMO_ENTER_SECRET: ${DEMO_ENTER_SECRET:-}` sur `admin`. |
| `AGENTS.md` | Une ligne : sandbox = flag, jamais sur un clone. |

---

## Chunk 1: Helpers purs + env

### Task 1: Tests de `demoSandbox`

**Files:**
- Create: `packages/backend/convex/lib/demoSandbox.test.ts`
- Create: `packages/backend/convex/lib/demoSandbox.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Préambule env (`BETTER_AUTH_SECRET`) comme les autres fichiers sous `convex/`.

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
  demoSandboxActif,
  estCompteDemo,
  modeleSandbox,
} from "./demoSandbox"

let originalEnv: NodeJS.ProcessEnv
beforeEach(() => {
  originalEnv = { ...process.env }
  delete process.env.DEMO_SANDBOX
  delete process.env.DEMO_ACCOUNT_EMAIL
  delete process.env.DEMO_OPENROUTER_MODEL
})
afterEach(() => {
  process.env = originalEnv
})

test("demoSandboxActif n'est vrai que pour la chaîne true", () => {
  expect(demoSandboxActif({})).toBe(false)
  expect(demoSandboxActif({ DEMO_SANDBOX: "1" })).toBe(false)
  expect(demoSandboxActif({ DEMO_SANDBOX: "true" })).toBe(true)
})

test("estCompteDemo compare l'e-mail normalisé, seulement si le flag est on", () => {
  const env = {
    DEMO_SANDBOX: "true",
    DEMO_ACCOUNT_EMAIL: "Demo@AstroTan.invalid",
  }
  expect(estCompteDemo({ email: "demo@astrotan.invalid" }, env)).toBe(true)
  expect(estCompteDemo({ email: "owner@illith.com" }, env)).toBe(false)
  expect(estCompteDemo({ email: "demo@astrotan.invalid" }, {})).toBe(false)
})

test("modeleSandbox lit l'env et ignore le settings", () => {
  expect(modeleSandbox({ openRouterModel: "x-ai/grok-4.6" }, {})).toBeNull()
  expect(
    modeleSandbox(
      { openRouterModel: "x-ai/grok-4.6" },
      { DEMO_SANDBOX: "true", DEMO_OPENROUTER_MODEL: "google/gemini-3.7-flash" },
    ),
  ).toBe("google/gemini-3.7-flash")
})
```

- [ ] **Step 2: Lancer, constater l’échec**

```bash
pnpm --filter @astrotan/backend exec vitest run convex/lib/demoSandbox.test.ts
```

Attendu : `demoSandboxActif is not a function` (ou module introuvable).

- [ ] **Step 3: Implémenter le helper**

`demoSandbox.ts` : fonctions pures, `env: Record<string, string | undefined>` en paramètre (signature que `check-env-wiring` reconnaît), jamais `process.env` nu sauf pour un wrapper mince `depuisProcess()` si un appelant Convex en a besoin — préférer passer `process.env` à la fonction reconnue.

`exigerPasDemo(authUser, env)` lève `ConvexError({ code: "DEMO_FORBIDDEN" })` si `estCompteDemo`.

`modeleSandbox` rend le slug **tel quel** (pas `assertOpenRouterModel`) : le modèle pas cher n’est pas forcément dans `OPENROUTER_MODELS`. Vide + flag on → `null` (l’appelant lève `DEMO_NOT_CONFIGURED`).

- [ ] **Step 4: Relancer, vert**

Même commande. Attendu : pass.

- [ ] **Step 5: Documenter les variables**

Ajouter à `packages/backend/.env.example` (fin de fichier) les 5 variables, commentaires au format existant (What / Where / Secret / If wrong).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/lib/demoSandbox.ts \
        packages/backend/convex/lib/demoSandbox.test.ts \
        packages/backend/.env.example
git commit -m "feat(demo): helpers et env du bac à sable"
```

---

## Chunk 2: Entrée Convex (`ouvert` / `credentials` / seed)

### Task 2: Query `demo.ouvert` et action `demo.credentials`

**Files:**
- Create: `packages/backend/convex/demo.ts`
- Create: `packages/backend/convex/demo.test.ts`
- Modify: `packages/backend/testing/registryModules.ts` (importer `demo` si une mutation publique est ajoutée — `credentials` est une action, pas au registre mutations ; `ouvert` est une query publique)

- [ ] **Step 1: Tests**

`demo.ouvert` rend `{ actif: boolean, adminUrl: string | null }` (jamais un booléen nu — un objet est always-truthy côté `/demo-enter`) :

```ts
expect(await t.query(api.demo.ouvert, {})).toEqual({
  actif: false,
  adminUrl: null,
})
process.env.DEMO_SANDBOX = "true"
process.env.SITE_URL = "https://admin.exemple.fr"
const ouvert = await t.query(api.demo.ouvert, {})
expect(ouvert.actif).toBe(true)
expect(ouvert.adminUrl).toMatch(/^https:\/\//)
```

`demo.credentials` : refuse sans flag (`DEMO_OFF`) ; refuse secret faux (`DEMO_FORBIDDEN`) ; refuse secret / email / password / `DEMO_OPENROUTER_MODEL` absents (`DEMO_NOT_CONFIGURED`) ; avec flag + bon secret + config complète, rend `{ email, password }`. Un secret faux ne contient pas le password.

Rate limit : hop `ctx.runMutation` (les `RateLimiter` du dépôt prennent un `MutationCtx` ; `credentials` est une action). Motif `leads.ts` / `consent.ts`.

`demo.jeSuisDemo` : query authentifiée, rend `estCompteDemo(authUser)`. Sans session → `false` (pas d’erreur). Créée ici pour que `/compte` et le bandeau n’attendent pas le chunk 5.

Comparer le secret avec `crypto.timingSafeEqual` sur des buffers de même longueur (si longueurs diffèrent → refuse, pas d’exception).

Rate limit : 10 / heure / clé IP. Premier test : le 11ᵉ appel avec la même clé échoue `DEMO_RATE_LIMITED`. Utiliser le rate-limiter déjà enregistré dans `makeTestConvex`.

- [ ] **Step 2: Lancer, échec**

```bash
pnpm --filter @astrotan/backend exec vitest run convex/demo.test.ts
```

- [ ] **Step 3: Implémenter `demo.ts`**

- `ouvert` : query publique, `args: {}`, rend `{ actif, adminUrl }` comme ci-dessus.
- `credentials` : action, `args: { secret: v.string(), ip: v.optional(v.string()) }`. Pas de session. Vérifie flag, les 5 env, secret (`timingSafeEqual`), rate limit via `ctx.runMutation`, rend `{ email, password }`.
- `jeSuisDemo` : query, session optionnelle.
- Ne pas logger le password.

- [ ] **Step 4: Tests verts**

- [ ] **Step 5: `demo.seedSandbox`**

internalMutation. Recopier le motif de `seedUser` dans `packages/backend/testing/betterAuthFixture.ts` (pas bootstrap — bootstrap émet une invitation, ici on crée le user tout de suite) :

```ts
const auth = createAuth(ctx)
await auth.api.createUser({
  body: {
    email: process.env.DEMO_ACCOUNT_EMAIL,
    password: process.env.DEMO_ACCOUNT_PASSWORD,
    name: "Démo",
    role: "editor",
  },
})
```

Idempotent par e-mail : si `listUsers` / findUserByEmail trouve déjà cette adresse, skip. Tests : deux appels → un seul user ; rôle `editor`. Flag off → `{ skipped: true }`. Config absente → `DEMO_NOT_CONFIGURED`.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(demo): entrée credentials et seed du compte editor"
```

---

## Chunk 3: Interdits + modèle IA

### Task 3: `exigerPasDemo` sur les sorties

**Files:**
- Modify: `packages/backend/convex/pages.ts` (`publishPage`)
- Modify: `packages/backend/convex/posts.ts` (publication)
- Modify: `packages/backend/convex/settings.ts` (`update` champs `openRouter*`)
- Modify: `packages/backend/convex/secrets.ts`
- Modify: `packages/backend/convex/invitations.ts` (`create`)
- Modify: `packages/backend/convex/emails.ts` (envois)
- Modify: `packages/backend/convex/dataforseo.ts`
- Modify: `packages/backend/convex/aiImage.ts`
- Modify: `packages/backend/convex/lib/authz.test.ts` **ou** `convex/demo.interdiction.test.ts` (préférer un fichier dédié pour ne pas gonfler authz)
- Modify: `packages/backend/convex/auth.ts` (`hooks.before`, motif `SIGN_IN_PATHS`)
- Modify: `apps/admin/src/routes/_authed/compte.tsx`

- [ ] **Step 1: Un test d’interdiction par famille**

Dans `demo.interdiction.test.ts` : seed un editor dont l’e-mail est `DEMO_ACCOUNT_EMAIL`, flag on, `identityFor` ce user.

```ts
process.env.DEMO_SANDBOX = "true"
process.env.DEMO_ACCOUNT_EMAIL = "demo@astrotan.invalid"
// sign in as that editor
await expect(identity.mutation(api.pages.publishPage, { id: pageId }))
  .rejects.toMatchObject({ data: { code: "DEMO_FORBIDDEN" } })
```

Même schéma pour `settings.update({ openRouterModel: "x-ai/grok-4.6" })`, `invitations.create`, un envoi e-mail existant (le plus petit `args` déjà testé dans `emails.test.ts`).

Un **autre** editor (`autre@exemple.fr`) **peut** publier si son rôle le permet — aujourd’hui editor ne publie pas. Donc le témoin positif est : owner n’est pas `estCompteDemo`, `publishPage` continue de marcher pour un owner (test déjà dans `pages.publishPage.test.ts` — le relancer).

**Owner + flag on** : `settings.update({ openRouterModel: "x-ai/grok-4.6" })` refuse (`DEMO_FORBIDDEN` ou `DEMO_MODEL_LOCKED`). Ce n’est **pas** `exigerPasDemo` (l’owner n’est pas le compte démo) : c’est `if (demoSandboxActif(env) && champOpenRouter) throw`. Sans ce test, le picker reste mutable même si `modeleEffectif` ignore la valeur.

- [ ] **Step 2: Échec puis une ligne `exigerPasDemo` après chaque `requireRole` concerné**

`requireRole` rend déjà `{ _id, role, email }` (`lib/authz.ts`).

```ts
const acteur = await requireRole(ctx, ["owner", "admin", "editor"])
exigerPasDemo(acteur, process.env)
```

Pour `publishPage` / `publishPost` : le rôle exigé reste owner/admin (inchangé). `exigerPasDemo` est une ceinture : un editor démo n’y arrive déjà pas par le rôle ; le helper protège si quelqu’un élargit le rôle plus tard, et sert surtout aux sorties accessibles à un editor (`aiImage`, médias au-delà du quota, e-mails s’il y en a).

Hook Better Auth (`auth.ts` `hooks.before`) : ajouter `/change-password` (et `/request-password-reset` si la session est celle du compte démo) — même motif que `SIGN_IN_PATHS` / `REQUEST_PASSWORD_RESET_PATHS`. Lève `DEMO_FORBIDDEN` si `estCompteDemo` sur la session. L’écran `/compte` masque le formulaire si `demo.jeSuisDemo`. Test : `t.fetch("/api/auth/change-password", …)` en session démo → 403.

- [ ] **Step 3: Matrice `MUTATION_REGISTRY`**

Si un nouvel `allowedRoles` change, mettre à jour le registre. Le compte démo n’est pas un rôle : la matrice existante reste. Ajouter un test dans `_registry` seulement si on ajoute une mutation publique.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(demo): interdire publication, sorties et modèle IA"
```

### Task 4: Forcer le modèle OpenRouter

**Files:**
- Modify: `packages/backend/convex/lib/openRouterModels.ts`
- Modify: `packages/backend/convex/lib/openRouterModels.test.ts`
- Modify: `packages/backend/convex/ai.ts` (passer par `modeleEffectif` + quota)
- Modify: `packages/backend/convex/lib/visitorAgent.ts`
- Modify: `apps/admin/src/routes/_authed/settings/agent.tsx` (masquer les `AiModelSelect` si `environment.demoSandbox`)
- Test: `packages/backend/convex/ai.demoQuota.test.ts`

- [ ] **Step 1: Test**

```ts
process.env.DEMO_SANDBOX = "true"
process.env.DEMO_OPENROUTER_MODEL = "google/gemini-2.5-flash-lite"
expect(modeleEffectif("x-ai/grok-4.6", process.env)).toBe(
  "google/gemini-2.5-flash-lite",
)
delete process.env.DEMO_SANDBOX
expect(modeleEffectif("x-ai/grok-4.6", process.env)).toBe("x-ai/grok-4.6")
```

Le slug sandbox n’a **pas** à être dans `OPENROUTER_MODELS`.

- [ ] **Step 2: `modeleEffectif` dans `demoSandbox.ts`** (déjà `modeleSandbox` au chunk 1) — `ai.ts` ligne ~108 et `visitorAgent.ts` l’utilisent à la place de `resolveOpenRouterModel(privee…)`. Passer `const env = process.env` (signature `Record<string, string | undefined>`) pour que `check-env-wiring.mjs` voie `DEMO_OPENROUTER_MODEL`.

- [ ] **Step 3: `settings.environment` rend `demoSandbox: boolean`**

Test dans `settings.environment.test.ts` : flag off → `false` ; flag on → `true`. Jamais d’e-mail ni de modèle dans le JSON (gardien comme les secrets).

- [ ] **Step 3b: Quota IA — 15 / heure / compte démo**

`useAction` n’a pas l’IP. Clé = `authUser._id` du compte démo. Motif `lib/chatRateLimit.ts` : `RateLimiter` + `ctx.runMutation` depuis l’action.

```ts
// dans demoSandbox.ts ou lib/demoAiQuota.ts
export const DEMO_AI_LIMIT = {
  kind: "token bucket" as const,
  rate: 15,
  period: HOUR,
  capacity: 15,
}
```

Tests (`ai.demoQuota.test.ts`) : flag off → pas de quota ; compte démo, 15 OK, 16ᵉ → `DEMO_RATE_LIMITED` ; un owner n’est pas limité par ce seau.

Dans `ai.generateSeoGeo`, après `requireRole` : si `estCompteDemo(acteur, env)` alors consommer le seau avant l’appel OpenRouter.

- [ ] **Step 3c: Masquer les sélecteurs**

`settings/agent.tsx` : si `environment?.demoSandbox`, ne pas rendre `AiModelSelect` / `OcrModelSelect`. Phrase FR : « Modèle imposé par le bac à sable. » Test source comme `agent.test.tsx` (le fichier vérifie déjà la présence de `AiModelSelect` — ajouter le branchement `demoSandbox`).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(demo): verrouiller le modèle OpenRouter en sandbox"
```

---

## Chunk 4: Reset + quota médias

### Task 5: `demo.restaurer` + cron

**Files:**
- Modify: `packages/backend/convex/demo.ts`
- Modify: `packages/backend/convex/demo.test.ts`
- Modify: `packages/backend/convex/crons.ts`

- [ ] **Step 1: Test restore**

Flag off → `{ skipped: true }`, aucune suppression.

Flag on + 2 posts `createdBy` = id du compte démo + 1 post d’un owner → après `restaurer`, 0 posts démo, le post owner reste. Pages seed inchangées.

- [ ] **Step 2: Implémenter**

`internal.demo.restaurer` : no-op sans flag ; sinon :

1. Trouver le user démo par e-mail (`createAuth(ctx).api.listUsers` / même lecture que `listUsersWithRole`).
2. Query posts + media `createdBy` = cet id ; `ctx.storage.delete` puis `ctx.db.delete`.
3. Relancer `seed:demoContent` (idempotent, ne touche pas `declaredDomain`).
4. Révoquer les sessions : `createAuth(ctx)` + `internalAdapter.deleteUserSessions(userId)` — **pas** un `db.delete` à la main sur les tables du composant. Test : après restore, `signIn` du compte démo crée une **nouvelle** session ; l’ancienne cookie ne passe plus `identityFor`.
5. Si le compte a disparu : appeler `demo.seedSandbox` (spec §8.5). Ne jamais créer un owner.

Flag off → `{ skipped: true }`, zéro delete.

- [ ] **Step 3: Cron**

```ts
crons.interval("demo-restore", { hours: 1 }, internal.demo.restaurer)
```

No-op partout sauf SRV2 : le flag est faux.

- [ ] **Step 4: Quota médias — 10 fichiers **ou** 20 Mo**

Le plafond se vérifie dans `media.register` (c’est là que `size` arrive ; `generateUploadUrl` ne connaît pas encore le fichier). `MAX_MEDIA_SIZE_BYTES` reste 10 Mo **par** fichier — le quota démo est un **cumul**.

```ts
const DEMO_MEDIA_MAX_FILES = 10
const DEMO_MEDIA_MAX_BYTES = 20 * 1024 * 1024
```

Si `estCompteDemo` : lister les médias `createdBy` ; si `count >= 10` **ou** `somme + args.size > 20 MiB` → `DEMO_QUOTA`.

Tests : 10 fichiers de 100 Ko → 10e OK, 11e refuse ; 3 fichiers de 7 Mo → le 3e refuse (21 > 20). Ne pas tester 11 Mo : `MAX_MEDIA_SIZE_BYTES` (10 Mo/fichier) lève `FILE_TOO_LARGE` avant `DEMO_QUOTA`. Un editor non-démo n’est pas plafonné.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(demo): restore horaire et quota médias"
```

---

## Chunk 5: Bouton + session + bandeau

### Task 6: Route admin `/demo-enter`

**Files:**
- Create: `apps/admin/src/routes/demo-enter.tsx`
- Modify: `apps/admin/src/routeTree.gen.ts` (régénéré par le plugin — lancer le dev/build admin une fois)
- Modify: `docker/.env.example` — documenter `DEMO_ENTER_SECRET` (runtime admin, pas `:?` obligatoire : un clone n’en a pas)
- Modify: `docker/docker-compose.yml` service `admin` `environment:` — `DEMO_ENTER_SECRET: ${DEMO_ENTER_SECRET:-}` (vide = `/demo-enter` 404)
- Modify: `docker/admin.Dockerfile` si un `ENV` runtime est requis (lire le Dockerfile : les `process.env` runtime n’ont pas besoin d’être `VITE_`)

- [ ] **Step 1: Test unitaire du handler pur si on extrait la logique**

Extraire `apps/admin/src/lib/demoEnter.ts` :

```ts
export function secretPresent(env: Record<string, string | undefined>): boolean {
  return Boolean(env.DEMO_ENTER_SECRET?.length)
}
```

Test vitest admin : secret absent → ne pas appeler Convex, répondre 404.

Le reste est un server handler : le tester en appelant la fonction exportée `entrerDemo({ ouvert, secretEnv, secretConvexOk })` qui rend `'404' | '429' | 'ok'`.

- [ ] **Step 2: Handler**

1. Secret admin absent → 404 (ne pas appeler Convex).
2. `ouvert` via ConvexHttpClient (pas de session). Si `!ouvert.actif` → 404 (`if (!ouvert)` est toujours vrai : c’est un objet).
3. Action `demo.credentials` avec `process.env.DEMO_ENTER_SECRET` et l’IP `x-forwarded-for`.
4. POST interne vers `/api/auth/sign-in/email` (même origine) avec email/password reçus.
5. 302 `/`.
6. 429 si rate limit.

Aucun `console.log` du password.

- [ ] **Step 3: Bandeau**

`demo-banner.tsx` : `useQuery(api.demo.jeSuisDemo)` (créée au chunk 2). Bandeau dans le layout `_authed` si vrai.

Texte (FR) : « Bac à sable partagé — vos brouillons sont effacés toutes les heures. Rien n’est publié sur le site. »

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(demo): route d'entrée et bandeau admin"
```

### Task 7: Bouton sur le site public

**Files:**
- Create: `apps/web/src/lib/demoOuvert.ts`
- Create: `apps/web/src/lib/demoOuvert.test.ts`
- Modify: `apps/web/src/pages/index.astro`

- [ ] **Step 1: Helper**

```ts
export function urlTester(ouvert: boolean, adminUrl: string | null): string | null {
  if (!ouvert || !adminUrl) return null
  return `${adminUrl.replace(/\/+$/, "")}/demo-enter`
}
```

Tests : false → null ; true + url → `https://admin.exemple.fr/demo-enter`.

- [ ] **Step 2: Dans `index.astro`**

Après `loadPage`, query `api.demo.ouvert` + origines admin (`settings.environment` n’est pas publique — elle exige un rôle). Donc `demo.ouvert` doit aussi rendre `adminUrl` **ou** le site lit `import.meta.env` / une query publique d’origines.

Ne pas élargir `settings.get` (projection publique). Soit :

- `demo.ouvert` rend `{ actif: boolean, adminUrl: string | null }` où `adminUrl` vient de `deriverOrigines` (déjà public comme barre d’adresse), **seulement** si `actif` ; sinon `{ actif: false, adminUrl: null }`.

Mettre à jour les tests de `demo.ouvert` du chunk 2.

Hero : `secondaryCta` devient « Tester le dashboard » si `urlTester` non null, sinon le CTA blog actuel. `footnote` (ou une ligne sous le CTA) : « Bac à sable partagé — reset toutes les heures. Rien n’est publié. » seulement si le bouton est là.

- [ ] **Step 3: Vérifier en local** (flag off) : pas de bouton. `curl` `/demo-enter` sur l’admin de démo plus tard.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(demo): bouton Tester sur le site public"
```

---

## Chunk 6: Câblage SRV2 + doc

### Task 8: Instance démo uniquement

- [ ] **Step 1: Poser les env Convex SRV2** (pas de valeurs dans Git)

`DEMO_SANDBOX=true`, e-mail, mot de passe (`openssl rand -base64 24`), `DEMO_ENTER_SECRET`, `DEMO_OPENROUTER_MODEL` (le modèle pas cher choisi), `OPENROUTER_API_KEY`.

`DEMO_ENTER_SECRET` aussi dans `~/astrotan/.env` pour le conteneur admin, puis recreate admin.

- [ ] **Step 2: `npx convex run demo:seedSandbox`** via le tunnel (parker `.env.local` anonymous).

- [ ] **Step 3: Recette**

1. Flag off (clone local) : pas de bouton, `/demo-enter` 404.
2. Flag on : bouton → dashboard, bandeau visible.
3. Créer un brouillon, Prévisualiser : 200 sur l’URL réelle.
4. Publier : erreur `DEMO_FORBIDDEN`.
5. Changer le modèle IA : refusé.
6. `generateSeoGeo` : part, modèle = `DEMO_OPENROUTER_MODEL`.
7. Attendre le cron ou `npx convex run internal.demo.restaurer` : brouillon disparu, session démo révoquée (retour `/login`).
8. Changer le mot de passe depuis `/compte` : refusé ; formulaire masqué.
9. 11ᵉ média : `DEMO_QUOTA`. 16ᵉ `generateSeoGeo` dans l’heure : `DEMO_RATE_LIMITED`.
10. `/demo-enter` en rafale : 429.

- [ ] **Step 4: Doc**

Une ligne dans `AGENTS.md` (Environment gotchas) : sandbox = `DEMO_SANDBOX=true` sur le Convex de démo uniquement ; un clone n’a jamais le bouton. Ne pas créer `docs/organisation.md` ici (autre PR).

- [ ] **Step 5: PR vers `main`, puis merge dans `demo`**

Les secrets restent sur le VPS. Le code inerte est dans `main`.

```bash
git checkout demo && git merge main && git push
```

---

## Hors scope (ne pas faire)

- 4ᵉ rôle Better Auth
- Tenant par visiteur
- Mot de passe affiché sur le site
- Allumer le sandbox sur un VPS adoptant
- Image IA / DataForSEO / Resend réel pour le compte démo

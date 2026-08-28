# Lot 4 — Redirections : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renommer le slug d'une page publiée n'abandonne pas ses visiteurs : l'ancienne URL redirige en 301 vers la nouvelle, automatiquement, et un opérateur peut ajouter ses propres redirections sans jamais rendre inatteignable un contenu vivant.

**Architecture:** Une table `redirects`, un middleware Astro qui la consulte avec un mémo court purgeable, et une exclusion mutuelle vérifiée **à l'écriture** entre un `from` de redirection et tout chemin que le site sert déjà. Le middleware ne fait aucun appel réseau par requête en régime normal.

**Tech Stack:** Astro 7.2.8 · @astrojs/node 11.1.4 · Convex 1.45.0 · Vitest + convex-test

**Spec:** `docs/superpowers/specs/2026-08-27-astrotan-design.md` (§6.4)

**Décisions acquises:** `docs/superpowers/notes/2026-08-28-lot4-redirections-decisions.md` — **à lire avant ce plan**. Un agent a planifié ce lot, a été arrêté avant d'implémenter, et son plan n'a jamais atteint le disque ; ce fichier est ce qui a survécu. Les quatre décisions et le piège qu'il contient ne sont pas rouvrables.

## Global Constraints

- **Versions exactes, jamais élargies.** Ce lot n'en monte aucune.
- **La navigation en base est hors périmètre.** Le menu et le pied de page vivent dans le balisage de chaque page (`SiteHeader.astro`, `SiteFooter.astro`), et lisent leur nom/logo/réseaux depuis `settings`. Ne créer ni table `navigation`, ni écran pour l'éditer.
- **Lire `CLAUDE.md`** avant d'écrire sous `packages/backend/`, et **invoquer le skill `convex-function`** — il porte la liste exacte des pièges de ce dépôt (préambule d'environnement des tests, registre + barrel, garde des queries publiques, cycle expand/migrate/contract).
- **Ne jamais lancer `npx convex dev`** : le contrôleur pousse et vérifie après chaque tâche touchant `convex/`.
- **Tout champ texte est borné**, sa constante exportée depuis `convex/content.ts` (module pur) et testée aux deux bornes. **Jamais depuis un module de fonctions** : `convex/redirects.ts` sera un point d'entrée de déploiement, et l'importer côté navigateur y traîne `auth.ts`. C'est arrivé trois fois sur cette branche.
- **`tsc` du backend et celui de l'admin ne sont pas équivalents** — lancer les deux.
- TDD strict, sortie de commande réelle dans les rapports, Conventional Commits en anglais, échanges en français.

## L'invariant du lot

> **Une redirection ne peut jamais rendre inatteignable un contenu vivant.** Ni une page publiée, ni un brouillon, ni un fichier de route, ni un chemin prérendu — quel que soit l'ordre dans lequel les écritures se produisent.

Juger le travail contre cette propriété, pas contre la liste des fichiers.

---

### Task 1: `lib/safeHref.ts`

**Files:** Créer `packages/backend/convex/lib/safeHref.ts` et son test.

**Produit:** `assertSafeHref(value, field)`, `isSafeHref(value)`.

- [ ] **Step 1: Écrire les tests qui échouent.** Acceptés : un chemin commençant par `/`, `https:`, `http:`, `mailto:`, `tel:`. Refusés : `javascript:`, `data:`, `vbscript:`, un chemin `//exemple.com` (URL protocol-relative — elle **sort du site** alors qu'elle ressemble à un chemin), un chemin `/\exemple.com` (même piège, variante que certains navigateurs normalisent en `//`), et toute chaîne contenant un caractère de contrôle (`\x00`–`\x1f`).
- [ ] **Step 2: Vérifier l'échec.**
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Brancher `seo.canonicalUrl`.** C'est l'autre champ URL stocké qui atterrit dans un attribut (`<link rel="canonical">`) sans passer par un assainisseur. Même helper, dans `assertPageTextWithinLimits` (`convex/content.ts`).
- [ ] **Step 5: Suite verte, commit** — `feat(backend): add a shared safe-href guard`

---

### Task 2: Chemins servis — la troisième source de vérité

**Files:** Créer `packages/backend/convex/lib/servedPaths.ts` et son test ; modifier `apps/web` pour engendrer le manifeste.

**C'est la tâche que l'agent précédent avait manquée**, et sans elle l'invariant du lot est faux. Voir la Décision 3 des notes.

Une page designée n'est **ni** une ligne publiée **ni** un chemin prérendu : `apps/web/src/pages/a-propos.astro` est en `prerender = false`, et sa ligne n'existe que si quelqu'un l'a créée. Une redirection `from: /a-propos` la masquerait sans qu'aucune garde ne s'y oppose — le middleware passe avant la route.

- [ ] **Step 1: Écrire le test qui échoue** — `assertPathAvailable` refuse un chemin correspondant à un fichier de route.
- [ ] **Step 2: Engendrer le manifeste au build.** Un script qui liste `apps/web/src/pages/**/*.astro` et écrit les chemins servis dans un module que le backend peut importer. **Engendré, jamais tenu à la main** : une liste écrite à la main diverge à la deuxième page, et c'est précisément le genre de dérive silencieuse que ce lot doit éviter. Les routes dynamiques (`blog/[slug].astro`) donnent un préfixe (`/blog/`), pas un chemin exact.
- [ ] **Step 3: Implémenter `assertPathAvailable(ctx, path)`** — refuse si le chemin correspond à : une ligne `pages` (publiée **ou** brouillon), un préfixe d'article (`/blog/…`), un fichier de route du manifeste, ou `RESERVED_PAGE_SLUGS` (`convex/posts.ts`).
- [ ] **Step 4: Suite verte, commit** — `feat(backend): generate the served-path manifest`

---

### Task 3: La table et son CRUD

**Files:** Créer `packages/backend/convex/redirects.ts` et son test ; modifier `schema.ts` (ajout seul), `content.ts` (bornes), `testing/registryModules.ts`.

```ts
redirects: defineTable({
  from: v.string(),   // chemin normalisé, sans slash de tête ni de fin
  to: v.string(),     // chemin ou URL absolue, passé par assertSafeHref
  code: v.union(v.literal(301), v.literal(302)),
  enabled: v.boolean(),
  createdBy: v.string(),
}).index("by_from", ["from"]),
```

- [ ] **Step 1: Écrire les tests qui échouent** — `create` refuse un `from` qui correspond à un contenu vivant (les quatre cas de la Task 2) ; refuse un `to` non sûr ; refuse un doublon de `from` ; refuse une boucle (`from === to`) et une chaîne de deux redirections qui se referme.
- [ ] **Step 2: Vérifier l'échec.**
- [ ] **Step 3: Implémenter `list`, `create`, `update`, `remove`.** Rôles : `owner`/`admin` — une redirection change ce que voit chaque visiteur du site.
- [ ] **Step 4: Le troisième point d'écriture.** Décision 2 des notes : `update` doit refaire la vérification **quand `enabled` repasse à `true`**. Sans ça, ce chemin passe entre les mailles : créer la redirection quand aucune page ne porte le slug (accepté) → la désactiver → créer la page (accepté, la redirection est inactive) → la réactiver, et la page est masquée sans qu'aucune garde n'ait jamais été franchie. **Écrire ce test en premier**, c'est le seul qui prouve la propriété.
- [ ] **Step 5: Registre + barrel, suite verte, commit** — `feat(redirects): add redirects with a write-time exclusion guard`

---

### Task 4: La réciproque, côté pages et articles

**Files:** Modifier `packages/backend/convex/pages.ts`, `posts.ts` et leurs tests.

- [ ] **Step 1: Écrire les tests qui échouent** — `pages.create`/`update` et `posts.create`/`update` refusent un slug qui correspond à une redirection **active** (`SLUG_HAS_REDIRECT`).
- [ ] **Step 2: Implémenter**, en réutilisant la fonction de la Task 2 plutôt qu'en écrivant une seconde vérification. `RESERVED_PAGE_SLUGS` (`posts.ts`) et cette garde sont le même mécanisme sur deux axes : les fusionner en une seule fonction de validation de slug, comme le disent les notes.
- [ ] **Step 3: Suite verte, commit** — `feat(pages,posts): refuse a slug an active redirect already answers`

---

### Task 5: Le 301 automatique au renommage

**Files:** Modifier `packages/backend/convex/pages.ts`, `posts.ts` et leurs tests.

- [ ] **Step 1: Écrire les tests qui échouent** — renommer le slug d'une page **publiée** crée une redirection 301 de l'ancien vers le nouveau ; renommer un **brouillon jamais publié** n'en crée aucune.
- [ ] **Step 2: Implémenter.** Décision 4 des notes : pas de 301 quand `publishedAt === undefined`. Sinon renommer trois fois un brouillon laisse trois redirections mortes, qui bloquent ensuite la création d'une page sur ces chemins par la garde de la Task 4.
- [ ] **Step 3: Suivre `settings.homePageSlug`.** `pages.update` le fait déjà — vérifier que les deux mécanismes coexistent sans se marcher dessus, avec un test.
- [ ] **Step 4: Suite verte, commit** — `feat(pages,posts): mint a 301 when a published slug is renamed`

---

### Task 6: Le middleware Astro

**Files:** Créer `apps/web/src/middleware.ts` et son test ; modifier `apps/web/src/pages/api/revalidate.ts`.

- [ ] **Step 1: Écrire les tests qui échouent** — une requête sur un `from` actif reçoit le code et la destination attendus ; une redirection désactivée est ignorée ; **une requête portant `?t=` traverse sans être redirigée**.
- [ ] **Step 2: Implémenter le middleware** avec un mémo de 60 s des redirections actives. Sans mémo, chaque requête du site paierait un aller-retour Convex ; avec, une 301 fraîche resterait invisible 60 s.
- [ ] **Step 3: Purger le mémo depuis `/api/revalidate`.** C'est ce qui ramène la latence de 60 s à quelques secondes, cohérent avec le reste du lot 2.
- [ ] **Step 4: Le piège de l'aperçu.** Notes, section « Piège » : `mintPreviewToken` signe le **slug** et l'aperçu s'ouvre sur l'URL réelle (`/tarifs?t=…`). Le middleware s'exécutant avant la route, il redirigerait un lien d'aperçu — et c'est exactement au moment où l'on prévisualise une page dont le slug vient de changer qu'on en a besoin. **Laisser passer toute requête portant `?t=`.**
- [ ] **Step 5: Vérifier dans un navigateur** — renommer le slug d'une page publiée depuis l'admin, puis appeler l'ancienne URL et constater la 301. Chronométrer.
- [ ] **Step 6: Commit** — `feat(web): resolve redirects in middleware with a purgeable memo`

---

### Task 7: L'écran d'administration

**Files:** Créer `apps/admin/src/routes/_authed/redirects.tsx` ; modifier `apps/admin/src/components/app-sidebar.tsx`.

> Le contrôleur réserve la route et l'entrée de navigation **avant** de dispatcher, comme pour `media`, `posts` et `settings` — c'est ce qui supprime la seule collision possible entre agents.

- [ ] **Step 1: Liste** avec TanStack Table (déjà installé, `9.2.3`) : `from`, `to`, code, actif. Tri sur `from`.
- [ ] **Step 2: Création et édition**, avec les refus du serveur rendus en phrases lisibles — jamais un code brut. Le cas le plus fréquent sera « ce chemin est déjà servi par une page » : le dire, et dire par quoi.
- [ ] **Step 3: Vérifier dans un navigateur** avec un compte administrateur. Si tu n'en as pas, en créer un : `npx convex run bootstrap:createInvitation '{"email":"…","role":"admin"}'` puis accepter le lien. **Ne pas rapporter comme vérifié un chemin que seul le refus a exercé** — c'est arrivé sur trois écrans de ce projet.
- [ ] **Step 4: Commit** — `feat(admin): add the redirects screen`

---

### Task 8: Bout en bout réel

- [ ] **Step 1:** Publier une page, la renommer, vérifier la 301 depuis l'ancienne URL, chronométrer l'apparition.
- [ ] **Step 2:** Créer une redirection vers un chemin déjà servi → refusée, avec un message lisible.
- [ ] **Step 3:** Le scénario de la Décision 2, en entier : créer une redirection, la désactiver, créer la page, tenter de réactiver → refusée.
- [ ] **Step 4:** Prévisualiser une page dont le slug vient de changer → le lien fonctionne, il n'est pas redirigé.
- [ ] **Step 5: Commit** — `test(e2e): verify the redirect loop end to end`

---

## Definition of Done — Lot 4

- [ ] L'invariant tient sur les **quatre** sources de vérité : ligne publiée, brouillon, fichier de route, chemin réservé.
- [ ] Le scénario de contournement de la Décision 2 est couvert par un test qui échoue sans la garde.
- [ ] Un lien d'aperçu traverse le middleware sans être redirigé.
- [ ] Le manifeste des chemins servis est **engendré**, jamais tenu à la main.
- [ ] Suites vertes sur les trois packages ; `tsc --noEmit` propre côté backend **et** côté admin ; lint sans erreur.
- [ ] `_generated` régénéré par le contrôleur contre un déploiement réel.
- [ ] Chaque écran vérifié dans un navigateur avec un compte **administrateur**, pas seulement sur son chemin de refus.

# Lot 7 — Le site public sur le template, et les leads : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le site public prend l'apparence du starter `astro-emdash` sur toutes ses pages, chacune est administrable et mesurée, et un visiteur peut écrire — le message arrivant dans le dashboard et dans la boîte des responsables.

**Architecture:** Le template fournit l'apparence et la structure ; notre code fournit les données et les garanties. Là où les deux se contredisent, le câblage gagne. Le formulaire n'écrit pas directement dans Convex : il passe par une route Astro qui voit l'IP, applique un pot de miel et limite le débit, puis appelle une mutation protégée par un secret partagé — le motif déjà employé par `/api/revalidate`.

**Tech Stack:** Astro 7.2.8 · Convex 1.45.0 · TanStack Start 1.168.49 · Resend · `@convex-dev/rate-limiter` · Umami 3.3.1

**Spec:** `docs/superpowers/specs/2026-08-27-astrotan-design.md`
**Template de référence:** https://astro-emdash.cloudbisnis.id/ (MIT)

## Global Constraints

- **Zéro JavaScript sur les pages de contenu**, hors bascule de thème.
  **Une seule exception, décidée explicitement : `/contact`**, dont le
  formulaire est un îlot React avec TanStack Form. Elle n'a pas vocation à
  être référencée, et le confort de saisie y vaut plus que les octets.
  Partout ailleurs, aucune directive `client:*` — et le texte de l'accueil
  doit dire « pages de contenu », pas « toutes les pages », sous peine
  d'être faux sur la page même qui le proclame.
- **`apps/web` n'a ni session ni clé d'administration.** Il ne lit que des queries publiques filtrant `status === "published"`. La seule écriture autorisée par ce lot passe par un secret partagé, côté serveur.
- **Une page est un couple** : un fichier `.astro` ET une ligne `pages` publiée. Sans la ligne, la route rend 404 — c'est voulu.
- **Invoquer `add-page`** avant de toucher à `apps/web/src/pages/`, `mockup-to-astro` pour l'intégration du design, `convex-function` avant `packages/backend/convex/`.
- **Aucun `style=""`, aucune `<img>` brute.** `<Image>` d'`astro:assets`, sans quoi rien n'est optimisé et rien ne le signale.
- **Après toute modification de `convex/`**, un `convex dev` réel : `tsc` et vitest ne voient pas ce que le runtime refuse.
- TDD, sortie réelle dans les rapports, Conventional Commits en anglais.

## L'invariant du lot

> **Rien de ce que le visiteur envoie n'est cru sur parole, et rien de ce qu'il voit ne dépend de son navigateur.** Un formulaire ouvert sur Internet est une porte : elle est étroite, mesurée, et ce qui la franchit est borné. Une page qui exige du JavaScript pour s'afficher est une page qui ne s'affiche pas.

---

### Task 1: Porter le template sur toutes les pages

**Files:** `apps/web/src/{styles,layouts,components,pages}/` — remplacement complet ; conserver `lib/`.

- [ ] **Step 1: Copier** l'arborescence du template, en gardant sa structure pour que la parenté reste lisible. Notice MIT conservée.
- [ ] **Step 2: Retirer ce qui ne peut pas suivre** — i18n, content collections, recherche modale, SQLite/R2. Retirer plutôt que reconstruire : chaque brique gardée « au cas où » est une dette dont personne ne connaîtra la raison.
- [ ] **Step 3: Rebrancher**, page par page — `prerender = false`, `loadPage`, `PageHead`, `Analytics`, `settings.homePageSlug` et la branche 404 avec son statut HTTP.
- [ ] **Step 4: L'en-tête n'affiche que la marque**, sans le nom en texte, avec un libellé accessible pour que le lien ne soit pas muet.
- [ ] **Step 5: Vérifier au navigateur** à 1440 / 768 / 375 px, côte à côte avec le site de référence. Coller les écarts constatés.
- [ ] **Step 6: Les garde-fous** doivent ne rien rendre :
  ```bash
  grep -rn 'style="' apps/web/src --include='*.astro'
  grep -rn '<img ' apps/web/src --include='*.astro'
  grep -rn 'client:' apps/web/src --include='*.astro'
  ```
- [ ] **Step 7: Commit** — `feat(web): rebuild the public site on the emdash template`

---

### Task 2: Déclarer chaque page dans l'administration

**Files:** `packages/backend/convex/seed.ts` ; le manifeste `servedPaths.generated.ts` (engendré).

Une page dont le fichier existe mais dont la ligne manque rend 404. C'est l'invariant qui protège les brouillons ; c'est aussi le piège au moment d'en ajouter cinq d'un coup.

- [ ] **Step 1: Lister les slugs** réellement servis, depuis le manifeste engendré au prebuild — pas depuis une liste écrite à la main, qui divergera.
- [ ] **Step 2: Étendre `seed:demoContent`** pour créer les lignes manquantes, idempotent par slug comme il l'est déjà.
- [ ] **Step 3: Lancer le seed** et vérifier dans `/pages` que chacune apparaît, publiée.
- [ ] **Step 4: Vérifier qu'une page non publiée rend bien 404** — l'invariant, exercé plutôt qu'affirmé.
- [ ] **Step 5: Commit** — `feat(backend): seed a row for every served page`

---

### Task 3: La mesure sur toutes les pages

- [ ] **Step 1: Poser `Analytics` dans le layout partagé**, et vérifier qu'aucune page ne contourne ce layout.
- [ ] **Step 2: Vérifier chaque route**, sortie collée :
  ```bash
  for p in / /a-propos /services /tarifs /contact /blog; do
    printf "%-12s %s\n" "$p" "$(curl -s http://127.0.0.1:4331$p | grep -c data-website-id)"
  done
  ```
  Chaque ligne doit valoir 1.
- [ ] **Step 3: Vérifier au navigateur** qu'une visite produit bien un `POST /api/send` répondant 200 — le script chargé ne prouve pas que la mesure part.
- [ ] **Step 4: Commit** — `feat(analytics): measure every public route`

---

### Task 4: Recevoir un message — le backend

**Files:** Créer `packages/backend/convex/leads.ts` et son test ; modifier `schema.ts` et `content.ts`.

Le template **n'a pas de formulaire de contact** — vérifié dans son code :
sa page `/contact` propose un lien `mailto:`, une liste de moyens de
contact et une façade de carte. Ce lot est donc une **addition**, habillée
avec le style de leur `Newsletter.astro`, le seul formulaire qu'ils aient.

- [ ] **Step 1: Écrire les tests qui échouent**
  - Un secret absent, faux, ou trop court fait refuser l'écriture. Comparaison à temps constant, comme `/api/revalidate`.
  - Les bornes de longueur sont appliquées côté serveur, jamais seulement dans le formulaire.
  - `list`, `markRead` et `remove` exigent un rôle ; l'écriture publique, non — c'est le point délicat, et il est testé dans les deux sens.
  - Un message vide, ou dont l'email est manifestement invalide, est refusé avec un code lisible.
- [ ] **Step 2: La table `leads`** — nom, email, corps, statut (`new` / `read`), date, et un index sur le statut pour la pastille de non-lus.
- [ ] **Step 3: Les bornes dans `content.ts`**, module pur : c'est le seul endroit que le navigateur peut importer sans traîner un point d'entrée de déploiement.
- [ ] **Step 4: `convex dev --once`** réel.
- [ ] **Step 5: Commit** — `feat(backend): accept contact messages through a narrow door`

---

### Task 5: La porte — la route Astro

**Files:** Créer `apps/web/src/pages/api/contact.ts` et son test sous `_tests/`.

> Rappel : un fichier de test sous `src/pages/` devient une route et casse `astro build`. `_tests/` est l'exclusion.

- [ ] **Step 1: Écrire les tests qui échouent** — le pot de miel rempli répond comme un succès sans rien écrire (dire « raté » à un robot, c'est lui apprendre à réussir) ; au-delà de la limite, 429 ; une charge utile trop grosse est refusée avant d'atteindre Convex.
- [ ] **Step 2: Implémenter**, avec le limiteur de débit Convex — pas une carte en mémoire, qui serait par processus et donc inexistante dès qu'il y a deux conteneurs.
- [ ] **Step 3: Le formulaire** est un îlot React (`client:load`) avec
      `@tanstack/react-form`, déjà installé côté admin et jamais utilisé.
      Il poste vers cette route. **Garder l'attribut `action` sur le
      `<form>`** : l'îlot intercepte quand il est chargé, le navigateur
      poste quand il ne l'est pas — le coût est d'une ligne, et il évite de
      perdre un message quand un script n'arrive pas.
- [ ] **Step 3 bis: Ajouter `@astrojs/react`** à `apps/web`, et vérifier que
      les autres pages n'embarquent toujours rien : `grep -rn 'client:'
      apps/web/src --include='*.astro'` ne doit citer que `contact`.
- [ ] **Step 4: Vérifier de bout en bout** au navigateur : envoyer un message, le voir arriver.
- [ ] **Step 5: Commit** — `feat(web): wire the contact form to its endpoint`

---

### Task 6: Les leads dans le dashboard

**Files:** Créer `apps/admin/src/routes/_authed/leads.tsx` ; modifier `app-sidebar.tsx`.

- [ ] **Step 1: L'écran `/leads`** — la liste des personnes qui ont écrit,
      **triée par date, la plus récente en tête** : c'est l'ordre dans lequel
      on répond. Table TanStack comme `/pages`, lecture, marquer traité,
      supprimer.
- [ ] **Step 2: La pastille de non-lus** dans la barre latérale.
- [ ] **Step 3: Les états** — aucune donnée, chargement, erreur. Un écran vide doit dire qu'il est vide, pas ressembler à un écran cassé.
- [ ] **Step 4: Vérifier avec un compte administrateur**, pas seulement sur son refus.
- [ ] **Step 5: Commit** — `feat(admin): add the leads screen`

---

### Task 7: Prévenir les responsables

**Files:** Modifier `packages/backend/convex/leads.ts`.

- [ ] **Step 1: Écrire les tests qui échouent** — la notification part aux comptes `owner` et `admin`, à personne d'autre ; un échec d'envoi **ne perd pas le message**, qui est déjà écrit.
- [ ] **Step 2: Implémenter** par une action planifiée, en réutilisant le chemin Resend des invitations.
- [ ] **Step 3: Commit** — `feat(backend): notify owners and admins of a new message`

---

### Task 8: Le skill, écrit après coup et pas avant

**Files:** Créer `.claude/skills/template-into-astrotan/SKILL.md`.

Écrit en dernier, une fois que tout marche : un skill rédigé d'avance décrit ce qu'on espérait, pas ce qui s'est passé.

- [ ] **Step 1: Recenser** ce qui a réellement résisté pendant les tâches 1 à 7.
- [ ] **Step 2: Écrire** — quels fichiers se copient tels quels, lesquels résistent et pourquoi, quels points de branchement ne doivent jamais sauter, dans quel ordre procéder pour que le build reste vert, et les pièges qui ont coûté du temps.
- [ ] **Step 3: Commit** — `docs(skills): record how to bring a third-party Astro template into this repo`

---

## Definition of Done — Lot 7

- [ ] Chaque page publique ressemble au template, à 1440, 768 et 375 px.
- [ ] Aucune directive `client:*` hors `/contact`, vérifié par `grep`.
- [ ] Le chiffre affiché sur l'accueil correspond à ce qui est réellement envoyé, page par page.
- [ ] Chaque page a sa ligne `pages` et apparaît dans `/pages`.
- [ ] `grep -c data-website-id` vaut 1 sur chaque route, et un `POST /api/send` observé.
- [ ] Un message envoyé depuis le site apparaît dans `/leads`, en tête de liste, et déclenche un email.
- [ ] Le formulaire poste quand même si l'îlot n'a pas chargé (`action` présent).
- [ ] Un secret manquant, faux ou court fait refuser l'écriture, et c'est testé.
- [ ] Le skill décrit ce qui s'est réellement passé.

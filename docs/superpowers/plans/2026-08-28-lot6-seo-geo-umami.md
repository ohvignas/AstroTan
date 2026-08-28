# Lot 6 — SEO, GEO et statistiques : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ce que le site publie est trouvable — par un moteur de recherche, par un moteur de réponse, et mesurable page par page sans qu'aucune donnée personnelle ne quitte l'infrastructure.

**Architecture:** Les champs existent déjà (`pages.seo`, `pages.geo`, idem sur `posts`, et `settings.defaultSeo`) : ce lot les **expose**. JSON-LD engendré depuis les mêmes données que les balises `<meta>`, `sitemap.xml` et `llms.txt` engendrés depuis Convex, et Umami auto-hébergé lu par le dashboard pour afficher les statistiques d'une page à côté de son éditeur.

**Tech Stack:** Astro 7.2.8 · Convex 1.45.0 · TanStack Start 1.168.49 · Umami

**Spec:** `docs/superpowers/specs/2026-08-27-astrotan-design.md` (§6.5)

## État de départ — audité, pas supposé

`PageHead.astro` rend déjà : `<title>`, `description`, `canonical`, `robots`
(incluant `noai`), `og:type`, `og:title`, `og:url`, `og:description`, plus
`description:summary` et `keywords` depuis les champs GEO.

**Absents :** `og:image`, toute Twitter Card, **tout JSON-LD**,
`sitemap.xml`, `robots.txt`, `llms.txt`, et toute mesure d'audience.

## Global Constraints

- **Versions exactes, jamais élargies.**
- **Invoquer le skill `add-page`** avant de toucher à `apps/web/src/pages/`, et `convex-function` avant `packages/backend/convex/`.
- **`apps/web` n'a ni session ni clé admin.** Toute query qu'il appelle filtre `status === "published"` côté serveur.
- **Ne jamais importer un point d'entrée Convex côté navigateur** — les constantes pures vivent dans `convex/content.ts`. Arrivé quatre fois sur cette branche.
- **Lancer les deux `tsc`** (backend et admin) : ils ne sont pas équivalents.
- **Aucun secret dans une image ni dans un build-arg** (contrainte du lot 5). La clé d'API Umami est un secret d'exécution.
- TDD strict, sortie réelle dans les rapports, Conventional Commits en anglais.

## L'invariant du lot

> **Rien de ce qui est exposé ici ne peut révéler un brouillon, et rien n'est mesuré qui identifie une personne.** Un `sitemap.xml`, un `llms.txt` ou un JSON-LD listant un contenu non publié est une fuite ; une statistique qui suit un individu est un problème légal.

---

### Task 1: `og:image` et les cartes sociales

Un lien partagé sans vignette perd l'essentiel de son taux de clic, et c'est le manque le plus visible de l'état actuel.

**Files:** Modifier `apps/web/src/components/PageHead.astro` ; créer son test.

- [ ] **Step 1: Écrire les tests qui échouent** — `og:image` est rendue depuis `seo.ogImageId`, retombe sur `settings.defaultSeo.ogImageId`, et est **absente** plutôt que vide quand ni l'une ni l'autre n'existe. Une balise `og:image` vide est pire que pas de balise : elle fait afficher un cadre cassé.
- [ ] **Step 2: Implémenter.** L'URL vient de `media.publicUrl` (déjà publique). Ajouter `og:image:width`/`height` depuis la ligne `media` quand elle existe — sans elles, plusieurs plateformes retardent l'affichage le temps de télécharger l'image.
- [ ] **Step 3: `twitter:card`** (`summary_large_image` quand il y a une image, `summary` sinon), `twitter:title`, `twitter:description`, `twitter:image`.
- [ ] **Step 4: Vérifier sur le site réel** — `curl` une page et coller les balises rendues.
- [ ] **Step 5: Commit** — `feat(seo): render og:image and twitter cards`

---

### Task 2: JSON-LD

C'est le format que les moteurs de réponse citent le plus fidèlement, et il n'y en a aucun aujourd'hui.

**Files:** Créer `apps/web/src/lib/jsonLd.ts` et son test ; modifier `PageHead.astro`.

- [ ] **Step 1: Écrire les tests qui échouent**
  - `Organization` global, depuis `settings` (nom, logo, `socials` en `sameAs`).
  - `Article` sur un article : `headline`, `datePublished`, `dateModified`, `image`, `author`.
  - `FAQPage` depuis `geo.faq` — **c'est la raison d'être de ce champ**, et il n'a aucun lecteur depuis le lot 2.
  - `BreadcrumbList` sur un article (`Accueil › Blog › titre`).
  - **Aucun JSON-LD n'est émis sous `geo.noai`** : publier un extrait conçu pour être cité, sur une page dont l'opérateur a demandé qu'elle ne le soit pas, viderait ce réglage de son sens.
  - **L'échappement** : `JSON.stringify` brut dans un `<script>` est une injection. Un titre contenant `</script>` doit sortir inerte. Écrire ce test en premier.
- [ ] **Step 2: Implémenter**, en échappant `<`, `>` et `&`.
- [ ] **Step 3: Vérifier** avec un validateur de données structurées réel, et coller le résultat.
- [ ] **Step 4: Commit** — `feat(seo): emit Organization, Article and FAQPage JSON-LD`

---

### Task 3: `sitemap.xml` et `robots.txt`

**Files:** Créer `apps/web/src/pages/sitemap.xml.ts` et son test sous `_tests/` ; `apps/web/public/robots.txt`.

> Rappel du lot 5 : un fichier de test sous `src/pages/` devient une route et casse `astro build`. Le répertoire `_tests/` est l'exclusion.

- [ ] **Step 1: Écrire les tests qui échouent**
  - Aucun brouillon dans le sitemap — c'est l'invariant du lot.
  - **L'échappement XML** : un titre ou un slug contenant `&` produit un XML invalide si on concatène des chaînes. Test en premier.
  - `lastmod` depuis `publishedAt`.
  - Les pages en `seo.noindex` sont exclues : les lister tout en demandant leur désindexation est contradictoire.
- [ ] **Step 2: Implémenter.** Les URL viennent des **chemins réellement servis** — le manifeste `servedPaths.generated.ts` du lot 4 existe déjà, plus les articles publiés. Une page publiée sans fichier de route ne doit pas y figurer : elle rend 404.
- [ ] **Step 3: `robots.txt`** statique, pointant le sitemap.
- [ ] **Step 4: Valider le XML avec un vrai parseur**, pas une inspection visuelle.
- [ ] **Step 5: Commit** — `feat(seo): generate sitemap.xml and ship robots.txt`

---

### Task 4: `llms.txt`

Le pendant GEO du sitemap : ce qu'un moteur de réponse lit pour savoir ce que ce site contient.

**Files:** Créer `apps/web/src/pages/llms.txt.ts` et son test.

- [ ] **Step 1: Écrire les tests qui échouent** — le fichier liste le nom du site, sa description, puis chaque page et article publiés avec leur `geo.summary` (à défaut, leur `seo.description`). **Toute page ou article portant `geo.noai` en est exclu.**
- [ ] **Step 2: Implémenter** au format Markdown de la convention `llms.txt`.
- [ ] **Step 3: Commit** — `feat(geo): generate llms.txt from the GEO fields`

---

### Task 5: Umami — la mesure

**Files:** Modifier `apps/web/src/components/PageHead.astro` (ou un composant dédié) ; `docker/` (service Umami) ; `docker/.env.example` ; `docker/README.md`.

- [ ] **Step 1: Décider de l'hébergement.** Umami auto-hébergé dans le même `docker compose`, avec sa base — c'est cohérent avec le reste du lot 5, et aucune donnée ne quitte le VPS. **Documenter le coût :** un service et une base de plus à sauvegarder.
- [ ] **Step 2: Le script sur le site**, chargé uniquement quand `PUBLIC_UMAMI_URL` et `PUBLIC_UMAMI_WEBSITE_ID` sont posés — sans quoi un adoptant qui n'en veut pas ne doit pas voir apparaître de requête vers un tiers.
- [ ] **Step 3: Vérifier ce qui est réellement envoyé.** Umami est sans cookie et sans donnée personnelle par défaut ; le vérifier dans l'onglet réseau et **coller la charge utile observée**, plutôt que de citer la promesse du site d'Umami.
- [ ] **Step 4: Commit** — `feat(analytics): add self-hosted Umami to the stack`

---

### Task 6: Umami — les statistiques dans le dashboard

**Files:** Créer `packages/backend/convex/analytics.ts` (une `action`, pas une `query` : elle fait un appel réseau sortant) ; modifier l'éditeur de page et d'article.

- [ ] **Step 1: Écrire les tests qui échouent** — l'action refuse sans session, et retourne un état lisible plutôt que de lever quand Umami est injoignable. **Un tableau de bord qui casse parce qu'un service tiers est en panne est pire qu'un tableau de bord sans chiffres.**
- [ ] **Step 2: Implémenter l'action.** La clé d'API Umami est lue depuis l'environnement Convex, **jamais exposée au navigateur**. Mettre en cache la réponse quelques minutes : l'écran est réactif et rappellerait l'API à chaque rendu.
- [ ] **Step 3: Afficher** vues et visiteurs sur 7 et 30 jours, à côté de l'éditeur de la page concernée. C'est là que le chiffre sert : en écrivant.
- [ ] **Step 4: Vérifier dans un navigateur avec un compte administrateur.** Si tu n'en as pas : `npx convex run bootstrap:createInvitation '{"email":"…","role":"admin"}'`. **Ne pas rapporter comme vérifié un chemin dont seul le refus a été exercé** — c'est arrivé trois fois sur ce projet.
- [ ] **Step 5: Commit** — `feat(admin): show per-page Umami statistics beside the editor`

---

### Task 7: Le poids, mesuré

Le lot 5 a montré que ce qui n'est pas mesuré n'est pas vrai. Les images passent déjà par `astro:assets` (vérifié : un PNG de 95 ko sort en WebP de 910 o). Restent les polices et le poids HTML.

- [ ] **Step 1: Mesurer l'état actuel** — poids transféré de chaque route, LCP, CLS. Coller les chiffres.
- [ ] **Step 2: Les polices.** Si une police auto-hébergée entre dans le projet : woff2 sous-ensemblée, `font-display: swap`, préchargement de la seule fonte au-dessus de la ligne de flottaison.
- [ ] **Step 3: Remesurer et coller l'avant/après.** Une optimisation sans mesure n'en est pas une.
- [ ] **Step 4: Commit** — `perf(web): report and improve the transferred weight`

---

## Definition of Done — Lot 6

- [ ] Aucun brouillon dans `sitemap.xml`, dans `llms.txt`, ni dans un JSON-LD.
- [ ] `geo.noai` supprime le JSON-LD **et** l'entrée `llms.txt` de la page concernée.
- [ ] Le JSON-LD passe un validateur de données structurées réel, résultat collé.
- [ ] Le `sitemap.xml` passe un parseur XML réel, avec un titre contenant `&` dans les données.
- [ ] La charge utile Umami est **observée** dans l'onglet réseau, pas citée.
- [ ] Le dashboard reste utilisable quand Umami est injoignable.
- [ ] La clé d'API Umami n'apparaît dans aucun bundle client ni aucune couche d'image.
- [ ] Les chiffres avant/après du poids transféré sont dans le rapport.
- [ ] Chaque écran vérifié avec un compte **administrateur**, pas seulement sur son refus.

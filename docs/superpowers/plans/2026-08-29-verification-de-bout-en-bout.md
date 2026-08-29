# Vérification de bout en bout — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUIS — utiliser `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Les étapes utilisent des cases à cocher (`- [ ]`).

**But :** prouver que chaque page du site est réellement branchée à tout ce que le produit promet — mesure, référencement, consentement, contenu — et que le dépôt documente chaque sujet qu'il contient.

**Architecture :** aucun code de fonctionnalité. Ce plan ajoute des **garde-fous exécutables** qui échouent quand une page perd un branchement, et comble les trous de documentation. Le principe : ce qui n'est vérifié que par une inspection à l'œil finit par régresser sans que personne ne le voie.

**Pile :** Astro 7 (`apps/web`), Convex, Umami 3.3.1 auto-hébergé, skills locaux sous `.claude/skills/`.

**Spec :** [`docs/superpowers/specs/2026-08-27-astrotan-design.md`](../specs/2026-08-27-astrotan-design.md)

## Ce qui est DÉJÀ vrai, et qu'il ne faut pas refaire

Mesuré sur le site en marche avant d'écrire ce plan, sur les huit pages :

| Page | Umami | JSON-LD | canonique | Open Graph | bandeau |
|---|:--:|:--:|:--:|:--:|:--:|
| `/`, `/fonctionnalites`, `/tarifs`, `/contact`, `/blog`, `/cookies`, `/mentions-legales`, `/confidentialite` | ✅ | ✅ | ✅ | ✅ | ✅ |

Le sitemap liste les 8 pages plus les 2 articles publiés. `llms.txt` répond. Toutes les pages passent par `BaseLayout`.

**Ce plan ne re-vérifie donc pas ça à la main. Il le rend impossible à casser en silence.**

## Contraintes globales

- **Environnement :** `export PATH="/opt/homebrew/bin:$PATH"` puis `corepack pnpm@10`. Convex CLI via `/opt/homebrew/bin/npx convex`. Un `convex dev` tourne — ne pas en lancer un second.
- **Références actuelles :** 694 tests backend, 222 admin, 135 web. Elles montent, jamais ne baissent.
- **Umami local :** `http://127.0.0.1:3002`, site `fb5c1ab0-1c7a-43f5-9d91-748a073605f1`. Identifiants d'API dans l'environnement Convex (`npx convex env list`).
- **Les skills locaux portent les erreurs réellement commises dans ce dépôt, pas des bonnes pratiques générales.** Un piège qu'on ne peut pas sourcer dans `git log` ou dans un commentaire ne s'écrit pas.
- Un fichier à nom simple sous `convex/` est un point d'entrée de déploiement. Les helpers de test vivent dans `packages/backend/testing/`.
- TDD. Commits en anglais, Conventional Commits. Commentaires en français.

---

## Tâche 1 : un test qui refuse une page non branchée

**Le défaut à empêcher :** une page ajoutée demain qui oublie `BaseLayout`, et qui n'est donc ni mesurée, ni référencée, ni couverte par le bandeau de consentement. **Le trou ne se verrait sur aucun écran** — la page s'afficherait parfaitement.

**Fichiers :**
- Créer : `apps/web/src/pages/_tests/branchement.test.ts`

**Interfaces :**
- Consomme : le manifeste des chemins servis, `packages/backend/convex/lib/servedPaths.generated.ts` (déjà généré par `pnpm generate:served-paths`)

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"

// Ce que ce fichier empêche : une page qui s'affiche parfaitement et qui
// n'est ni mesurée, ni référencée, ni couverte par le bandeau de
// consentement — parce qu'elle a oublié `BaseLayout`. Le trou ne se voit sur
// aucun écran, et c'est exactement pourquoi il faut un test.

const PAGES = join(import.meta.dirname, "..")

function fichiersDePage(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = join(dossier, e.name)
    if (e.isDirectory()) return e.name === "_tests" || e.name === "api" ? [] : fichiersDePage(chemin)
    return e.name.endsWith(".astro") ? [chemin] : []
  })
}

describe("toute page publique passe par un layout", () => {
  const pages = fichiersDePage(PAGES)

  test("il y a bien des pages à vérifier", () => {
    // Sans ce canari, un chemin de dossier cassé rendrait la suite verte
    // en ne vérifiant rien du tout.
    expect(pages.length).toBeGreaterThanOrEqual(9)
  })

  test.each(pages.map((p) => [p.replace(PAGES, ""), p]))(
    "%s importe BaseLayout ou BlogLayout",
    (_nom, chemin) => {
      const source = readFileSync(chemin, "utf8")
      // `BaseLayout` porte `PageHead` (SEO, GEO, JSON-LD, canonique),
      // `Analytics` (Umami) et `ConsentBanner`. Une page qui le contourne
      // perd les trois d'un coup.
      expect(source).toMatch(/from "\.\.?\/(\.\.\/)?layouts\/(Base|Blog)Layout\.astro"/)
    },
  )

  test.each(pages.map((p) => [p.replace(PAGES, ""), p]))(
    "%s déclare prerender = false",
    (_nom, chemin) => {
      // Une page prérendue lirait sa ligne Convex au BUILD : dépublier ne
      // la retirerait plus du site, et l'aperçu d'un brouillon montrerait
      // l'état figé de la dernière construction.
      expect(readFileSync(chemin, "utf8")).toContain("export const prerender = false")
    },
  )
})
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il PASSE, puis prouver qu'il mord**

```bash
export PATH="/opt/homebrew/bin:$PATH" && cd apps/web && corepack pnpm@10 exec vitest run src/pages/_tests/branchement.test.ts
```

Attendu : vert (l'état actuel est bon). **Puis vérifier qu'il échoue quand il doit** — c'est la seule preuve qu'un garde-fou en est un :

```bash
printf -- '---\nexport const prerender = false\n---\n<p>bidon</p>\n' > src/pages/zz-bidon.astro
corepack pnpm@10 exec vitest run src/pages/_tests/branchement.test.ts   # doit ÉCHOUER sur BaseLayout
rm src/pages/zz-bidon.astro
corepack pnpm@10 exec vitest run src/pages/_tests/branchement.test.ts   # doit repasser au vert
```

Un test qui n'a jamais été vu rouge n'a pas été vérifié.

- [ ] **Étape 3 : commit**

```bash
git add apps/web/src/pages/_tests/branchement.test.ts
git commit -m "test(web): fail when a page skips the layout that wires everything

A page that forgets BaseLayout loses measurement, SEO metadata and the
consent banner in one go — and renders perfectly, so nothing on any screen
shows the hole. Proven to bite: a throwaway page without the layout turns
this suite red."
```

---

## Tâche 2 : le sitemap ne peut plus oublier une page

**Le défaut à empêcher :** une page publiée absente du sitemap, ou une page dépubliée qui y reste. Les deux sont déjà arrivés dans ce dépôt — l'accueil était absent du sitemap parce que son slug est `accueil` et son chemin `/`.

**Fichiers :**
- Modifier : `apps/web/src/lib/feeds.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
test("toute page publiée figure au sitemap, et l'accueil y figure à `/`", () => {
  // Le piège déjà payé : l'accueil a le slug `accueil` mais répond à `/`.
  // Comparer les slugs aux chemins l'a fait disparaître du sitemap une
  // première fois, puis badger « sans fichier » dans le tableau de bord.
  const pages = [
    { slug: "accueil", title: "Accueil", status: "published" as const },
    { slug: "contact", title: "Contact", status: "published" as const },
    { slug: "secrete", title: "Secrète", status: "draft" as const },
  ]
  const urls = sitemapUrls(pages, [], "https://exemple.fr", "accueil")
  expect(urls).toContain("https://exemple.fr")
  expect(urls).toContain("https://exemple.fr/contact")
  expect(urls).not.toContain("https://exemple.fr/accueil")
  // Un brouillon dans le sitemap est une fuite : il annonce à un moteur
  // une adresse qui répond 404, et révèle son existence.
  expect(urls.join(" ")).not.toContain("secrete")
})
```

Adapter les noms aux fonctions réellement exportées par `apps/web/src/lib/feeds.ts` — **les lire avant d'écrire**, ne pas inventer de signature.

- [ ] **Étape 2 : vérifier l'échec, implémenter si besoin, vérifier le passage**

- [ ] **Étape 3 : commit**

---

## Tâche 3 : la mesure arrive vraiment jusqu'à Umami

**Le défaut à empêcher :** la balise est dans le HTML — c'est prouvé — mais rien ne prouve que les vues **arrivent**. Une URL d'API fausse, un identifiant de site erroné, un pare-feu : la page se charge, la balise part, et le tableau reste vide. C'est exactement le genre de panne muette que ce dépôt a déjà connue quatre fois sur l'API Umami.

**Ce n'est pas un test unitaire** : ça demande une instance Umami en marche. C'est un **script de vérification**, lancé à la main après un déploiement.

**Fichiers :**
- Créer : `scripts/check-tracking.mjs`
- Modifier : `docker/README.md` (une ligne dans la procédure de mise en service)

- [ ] **Étape 1 : écrire le script**

Il doit, dans cet ordre :

1. lire les identifiants d'API dans l'environnement Convex (`UMAMI_API_URL`, `UMAMI_API_USERNAME`, `UMAMI_API_PASSWORD`, `UMAMI_API_WEBSITE_ID`) ;
2. obtenir un jeton par `POST /api/auth/login` ;
3. appeler `GET /api/websites/<id>/metrics?startAt=…&endAt=…&type=path&limit=50` — **`type=path`, pas `type=url`** : `url` répond 400 en Umami 3, le piège est consigné dans le skill `umami-read-api` ;
4. comparer l'ensemble des chemins vus à l'ensemble des chemins servis, lu depuis `packages/backend/convex/lib/servedPaths.generated.ts` ;
5. sortir en 1 en nommant **chaque chemin servi qui n'a reçu aucune vue** sur la fenêtre.

Deux précisions qui décident de l'utilité du script :

- **Une fenêtre par défaut de 7 jours**, réglable. Sur 24 h, une page peu visitée sort en faux positif et le script devient du bruit qu'on ignore.
- **Le rapport distingue « aucune vue » de « erreur d'appel ».** Un 401 sur l'API et une page jamais visitée ne demandent pas le même geste, et les confondre a déjà fait chercher au mauvais endroit.

- [ ] **Étape 2 : le lancer contre l'instance réelle**

```bash
export PATH="/opt/homebrew/bin:$PATH" && node scripts/check-tracking.mjs
```

Le tableau de bord de référence : <http://127.0.0.1:3002/websites/fb5c1ab0-1c7a-43f5-9d91-748a073605f1>

**Rapporter ce qui est vu, pas ce qui est attendu.** Si des pages n'ont aucune vue parce que personne ne les a visitées, le dire — c'est une information sur le jeu de données, pas une panne.

- [ ] **Étape 3 : prouver que le script mord**

Le lancer avec un identifiant de site volontairement faux : il doit sortir en 1 avec un message qui nomme la cause, jamais rendre « tout va bien ».

- [ ] **Étape 4 : commit**

---

## Tâche 4 : le skill qui manque le plus — les secrets

**Le trou :** l'architecture de chiffrement a une spec (`docs/superpowers/specs/2026-08-29-secrets-et-chiffrement.md`) mais **aucun skill**. Un agent qui doit ajouter un jeton demain ne trouvera rien dans `.claude/skills/`, et refera les choix de travers — probablement en rangeant la valeur dans `settings`, dont la query `get` est publique.

**Fichiers :**
- Créer : `.claude/skills/secrets-convex/SKILL.md`
- Modifier : `CLAUDE.md` (table des skills), `AGENTS.md`

- [ ] **Étape 1 : lire avant d'écrire**

Dans cet ordre : la spec ci-dessus, puis `packages/backend/convex/secrets.ts`, `lib/secretsCrypto.ts`, et les tests des deux. Le skill décrit ce que le code FAIT, pas ce qu'on voudrait qu'il fasse.

- [ ] **Étape 2 : écrire le skill**

Frontmatter comme les autres skills locaux :

```
---
name: secrets-convex
description: Use when adding, reading, rotating or removing a secret or API token — OpenRouter, Resend, Umami, a webhook secret. Also use when asked "where does this key live", "why is my key ignored", "add a token to the settings screen", or when a value must reach a Convex action without reaching the browser.
---
```

Le corps doit contenir, et rien de décoratif autour :

- **Le modèle en une phrase** : trois endroits possibles, et un seul est correct selon ce que la valeur doit atteindre.
- **Le tableau des trois endroits** — `PUBLIC_*` figée au build et visible de tous / `process.env` du conteneur / environnement Convex — avec, pour chacun, *qui peut le lire*.
- **Ajouter un jeton, pas à pas** : le nom dans `SECRET_NOMS`, le champ à l'écran, et le passage obligé par `lireSecret` côté consommateur. **Insister sur ce dernier point** : un jeton rangé que personne ne lit est un réglage décoratif, et c'est arrivé — la clé Resend a été saisissable pendant un temps sans qu'aucun envoi ne la lise.
- **La règle de précédence** : l'environnement l'emporte, et c'est écrit à l'écran, sinon quelqu'un saisit une clé et cherche pourquoi elle n'a pas d'effet.
- **Les pièges déjà payés**, chacun sourçable :
  - `settings.get` est PUBLIQUE et a déjà laissé fuiter `leadWebhookSecret` ; sa projection explicite est ce qui l'a refermé ;
  - `settings.getPrivate` avait le même défaut, un cran plus bas, découvert par une revue ;
  - chiffrer dans une **action** et non une mutation, parce que Convex ensemence l'aléa des mutations et qu'AES-GCM exige un IV neuf ;
  - `import.meta.env` est **inliné à la compilation**, y compris pour les clés sans préfixe.
- **La vérification qui compte** : la commande qui prouve qu'une valeur sentinelle n'apparaît dans le JSON d'aucune query.
- **Ce que le dispositif n'achète pas** : il protège d'une fuite de la base, pas d'une compromission du déploiement, qui détient les deux moitiés.

- [ ] **Étape 3 : inscrire le skill dans les deux index**

- [ ] **Étape 4 : commit**

---

## Tâche 5 : les trois autres skills manquants

**Le trou :** trois sujets que le dépôt contient et que rien ne documente pour un agent. Chacun a déjà produit un défaut réel, ce qui est le critère de ce dépôt pour écrire un skill.

**Fichiers :**
- Créer : `.claude/skills/leads-et-formulaire/SKILL.md`
- Créer : `.claude/skills/admin-tanstack/SKILL.md`
- Créer : `.claude/skills/tests-convex/SKILL.md`
- Modifier : `CLAUDE.md`, `AGENTS.md`

- [ ] **Étape 1 : `leads-et-formulaire`**

Ce qu'il doit porter, tout sourçable dans `git log` :

- le formulaire est **le seul chemin d'écriture public** du backend, et pourquoi la porte est étroite : secret partagé, empreinte d'IP, deux compteurs de débit ;
- **le lead est enregistré quoi qu'il arrive** — un webhook qui échoue ou un email qui ne part pas ne doivent jamais faire perdre le message ;
- le webhook part **après** l'écriture, jamais avant ;
- le piège payé : `astro dev` ne charge pas `.env.local` dans `process.env`, d'où « envoi momentanément indisponible » en développement, et le contournement (`node --env-file-if-exists`) ;
- le piège payé : l'URL du webhook **ne s'auto-sauvegarde pas**, parce que `https://exemple.co` est une adresse valide en route vers `https://exemple.com` ;
- la vue Liste porte le clavier et le tactile, ce qui a permis de retirer dnd-kit.

- [ ] **Étape 2 : `admin-tanstack`**

- une route = un fichier sous `apps/admin/src/routes/` ; `_authed/` porte la session ;
- **le piège payé, en tête** : un hook posé après un retour anticipé casse l'écran entier avec « Rendered more hooks than during the previous render » — c'est arrivé sur `/leads` ;
- `environment: "node"` et pas de jsdom : les tests de rendu passent par `renderToStaticMarkup` ;
- **le piège payé** : le `Select` de Base UI exige `items` sur la racine, sinon `SelectValue` affiche la valeur brute — « new » au lieu de « Nouveau » ;
- **le piège payé** : un élément flex sans `min-w-0` refuse de se rétrécir, d'où deux barres de défilement horizontales sur le tableau des leads ;
- la barre de sauvegarde et ce qui ne s'auto-sauvegarde jamais.

- [ ] **Étape 3 : `tests-convex`**

- `convex-test` + `makeTestConvex` de `packages/backend/testing/betterAuthFixture.ts` ;
- **le piège payé** : une fixture placée sous `convex/` casse le déploiement avec `TypeError: import.meta unsupported`, alors que les tests étaient verts et le typecheck propre ;
- `MUTATION_REGISTRY` couvre les mutations **et** les actions publiques ;
- `pages.publicQueryFamily.test.ts` échoue exprès sur une forme d'arguments inconnue : lui enseigner la forme, jamais contourner ;
- le préambule `BETTER_AUTH_SECRET` / `SITE_URL` / `PREVIEW_SECRET` que chaque suite doit poser ;
- **la règle qui prime sur tout** : `tsc` et vitest ne voient pas ce que le runtime Convex refuse. Un push réel avant de considérer une tâche finie.

- [ ] **Étape 4 : inscrire les trois dans `CLAUDE.md` et `AGENTS.md`, commit**

---

## Tâche 6 : un garde-fou sur la documentation elle-même

**Le défaut à empêcher :** `CLAUDE.md` et `AGENTS.md` divergent, ou un skill existe sans être inscrit dans l'index — donc invisible pour l'agent qui en aurait besoin. Les deux fichiers portent déjà un avertissement disant que les modifier séparément les fait diverger ; rien ne le vérifie.

**Fichiers :**
- Créer : `scripts/check-docs.mjs`
- Modifier : `.github/workflows/ci.yml`

- [ ] **Étape 1 : écrire le script**

Il vérifie trois écarts, tous dérivés des fichiers eux-mêmes :

1. tout dossier de `.claude/skills/` apparaît dans la table des skills de `CLAUDE.md` ;
2. tout skill a un frontmatter avec `name` et `description`, et le `name` correspond au nom du dossier ;
3. tout invariant numéroté d'`AGENTS.md` a son pendant dans `CLAUDE.md` — comparé sur le NOMBRE d'invariants, pas sur le texte, qui est délibérément plus long d'un côté.

Sortie non nulle sur écart, avec le nom de ce qui manque.

- [ ] **Étape 2 : prouver qu'il mord**

Créer un skill bidon sans l'inscrire dans `CLAUDE.md`, lancer le script, vérifier qu'il sort en 1 en le nommant, puis supprimer le skill bidon.

- [ ] **Étape 3 : brancher en CI, commit**

---

## Tâche 7 : la vérification humaine, une fois

Ce que rien n'automatise, et que personne n'a fait. À dérouler **dans un navigateur**, une session ouverte.

- [ ] Le site en navigation privée : le bandeau, « Tout refuser », puis l'onglet réseau — aucune requête tierce
- [ ] Le même parcours en acceptant : les balises apparaissent, et elles seules
- [ ] Le formulaire de contact : un envoi arrive dans `/leads`
- [ ] Le formulaire six fois de suite : le sixième est refusé avec le message d'attente, pas une erreur de panne
- [ ] `/leads` : glisser une carte, la vue Liste, la frise d'une fiche
- [ ] `/settings/identite` : le champ logo montre une image
- [ ] `/settings/domaine` : saisir une clé, recharger, vérifier qu'elle est dite « configurée » sans jamais réafficher sa valeur
- [ ] `/` : la courbe et ses trois granularités
- [ ] Le tableau Umami — <http://127.0.0.1:3002/websites/fb5c1ab0-1c7a-43f5-9d91-748a073605f1> — porte les vues de ce parcours

---

## Ordre recommandé

1. **Tâches 1, 2, 6** — des garde-fous, peu coûteux, qui figent l'état sain actuel avant qu'il ne bouge.
2. **Tâches 4 et 5** — la documentation manquante ; la 4 en premier, c'est le sujet le plus récent et le plus facile à refaire de travers.
3. **Tâche 3** — le script de mesure, qui demande une instance en marche.
4. **Tâche 7** — après chaque lot, pas seulement à la fin.

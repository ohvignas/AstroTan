---
name: add-page
description: Use when adding, removing or changing a page of the public Astro site in apps/web — a new route file, a landing page, a legal page, anything under apps/web/src/pages/. Also use when asked "how do I add a page", when a page returns 404 unexpectedly, when wiring SEO or GEO fields, or when a preview link does not open.
---

# Ajouter une page au site

## Le modèle, en une phrase

**Une page *est* son fichier `.astro`.** Le balisage, la mise en page et les
mots s'écrivent en code. La base de données ne porte **aucun contenu** : la
ligne `pages` ne décide que du slug, du titre, de la publication, et des
champs SEO/GEO.

| Question | Répondue par |
|---|---|
| Cette page est-elle en ligne ? | l'admin (`status`) |
| Sur quel chemin répond-elle ? | le fichier (slug) ; l'admin le voit |
| Qui doit la trouver ? | la fiche (`seo`, `geo`) — **à remplir à la création** |
| Que contient-elle, à quoi ressemble-t-elle ? | **le code** |

Trois modèles de contenu ont été essayés puis retirés de ce dépôt : une union
de blocs, un corps Markdown, une carte de champs de texte déclarés. Chacun
était une seconde façon, plus faible, de faire ce que le code fait déjà. **Ne
pas en réintroduire un.**

## La marche à suivre

### 1. Créer le fichier

`apps/web/src/pages/<slug>.astro`, avec ces quatre lignes en tête :

```astro
export const prerender = false

import { loadPage } from "../lib/loadPage"
import BaseLayout from "../layouts/BaseLayout.astro"
const { page } = await loadPage(Astro)
```

Omettre le slug. `loadPage` le dérive du chemin. Le seul appelant légitime
d'un slug explicite est `index.astro`, parce que `/` n'a pas de segment.

`loadPage` fait tout le reste : la recherche publiée, l'aperçu par `?t=`, le
statut 404, et les tags de cache. `PageHead` vit dans `BaseLayout` : titre,
description, canonique, `robots`, Open Graph, GEO. Ne pas le réimporter
dans la page.

Le gabarit à recopier est `apps/web/src/pages/fonctionnalites.astro` :
`BaseLayout` sans ternaire. `contact.astro` et `tarifs.astro` ont encore
un `{page === null ? …}` — **ne pas le copier**.

### 2. Envelopper dans `BaseLayout`

```astro
<BaseLayout page={page} fallbackTitle="…">
  <!-- le contenu de la page -->
</BaseLayout>
```

`loadPage` pose le statut 404 quand la ligne n'est pas publiée. `BaseLayout`
rend alors `NotFoundBody` à la place du slot, et le bandeau d'aperçu quand
`Astro.locals.preview` est vrai — **aucun ternaire, aucun bandeau à
ajouter**. Un vibecodeur qui oublie `{page === null ? …}` n'expose pas un
brouillon.

### 3. Créer la fiche Convex — pas depuis l'admin

L'écran Pages n'a **pas** de bouton « Nouvelle page ». C'est l'agent qui
crée la ligne, dans le même geste que le fichier, **même slug**. Deux
mécanismes réels, aucun autre :

- **`pages.create({ title, slug })`** — mutation publique, brouillon,
  session owner/admin/editor. C'est le chemin pour une page d'un site
  déjà installé. `npx convex run pages:create` **échoue** : la mutation
  lit la session, le CLI n'en a pas.
- **Page du template** (elle voyage avec le dépôt) : une entrée dans
  `DEMO_PAGES` de `packages/backend/convex/seed.ts`, puis
  `npx convex run seed:demoContent`. Idempotent par slug, écrit via
  `ctx.db` sans session — le seul `npx convex run` qui crée une fiche.

`pages.create` ne prend que `{ title, slug }`. **Enchaîner tout de suite
`pages.update({ id, seo, geo })`** — ou, dans le seed, poser `seo` et
`geo` sur l'`insert`. L'admin peut encore les ajuster et publier
(`pages.publishPage`) ; ce n'est pas une raison de les laisser vides.
Tant que la fiche est en brouillon, la route répond 404 — c'est
l'invariant, pas un défaut.

Le menu admin liste **chaque** fichier, même sans fiche :
`pages.list` fusionne les lignes Convex et `cmsSlugsFromServedPaths()` ;
sans fiche : `missingRow: true`, `_id: null`, badge « Sans fiche ». Sans
fiche on ne peut ni publier ni régler le SEO. Fichier et slug sont
identiques, sauf l'accueil : `index.astro` sert `/`.

### SEO et GEO — checklist à la création

Valeurs **de cette page**, pas un reste de template (« Page de
démonstration livrée avec AstroTan »). Bornes : `content.ts`.

**`seo`** (`seoValidator`) — ce que `PageHead` met dans `<head>` :

| Champ | Rôle | Borne |
|---|---|---|
| `title` | `<title>` / `og:title` ; sinon `page.title` | 70 |
| `description` | meta / `og:description` ; sinon `settings.defaultSeo` | 160 |
| `canonicalUrl` | sinon l'URL courante (sans query) | 2048, href sûr |
| `noindex` | `robots` → `noindex, nofollow` ; exclus de `llms.txt` | bool |
| `ogImageId` | image de partage (`_storage`) ; sinon `defaultSeo.ogImageId` | id média existant, sinon omettre |

Pas de champ `robots` ni d'objet `og` : `robots` est dérivé de
`noindex` + `geo.noai`.

**`geo`** (`geoValidator`) — citation par un moteur de réponse :

| Champ | Rôle | Borne |
|---|---|---|
| `summary` | extrait ; `llms.txt` + meta `description:summary` | 500 |
| `faq` | `{ question, answer }[]` → JSON-LD `FAQPage` | 20 × (200 / 1000) |
| `entities` | sujets de la page → meta `keywords` | 20 × 100 |
| `noai` | interdit la reproduction (`noai`, pas de JSON-LD / `llms.txt`). Distinct de `seo.noindex`. | bool |

Pages légales : tant que `ASTROTAN_TEMPLATE_NOT_YET_CUSTOMIZED`
(`apps/web/src/config/legal.ts`) est `true`, le site **refuse de publier
l'identité d'exemple** (AstroTan comme responsable) et force `noindex`
sur mentions / confidentialité / cookies. Ne pas recopier ces valeurs
dans `seo` / `geo`.

### 4. `servedPaths` suit le prochain `dev` / `build`

`apps/web` a `predev` et `prebuild` → `generate:served-paths`
(`scripts/generate-served-paths.mjs`), qui réécrit
`packages/backend/convex/lib/servedPaths.generated.ts`. C'est ce
manifeste que `cmsSlugsFromServedPaths()` lit. Relancer
`pnpm --filter @astrotan/web dev` suffit.

Si l'admin tourne déjà et que le nouveau slug n'apparaît pas : une fois
`pnpm --filter @astrotan/web generate:served-paths`. Ce n'est pas un
rituel — c'est le même hook que le build.

## Le piège qui coûte cher, et qui est silencieux

**`astro:assets` n'optimise que les images importées depuis `src/`.** Une
image servie depuis `public/` traverse le pipeline sans être touchée : pas de
`srcset`, pas d'AVIF/WebP, pas de redimensionnement. Le site marche, il
n'optimise simplement rien, et rien ne le signale.

```astro
---
import { Image } from "astro:assets"
import hero from "../assets/hero.jpg"   // ← src/, jamais public/
---
<Image src={hero} alt="…" loading="eager" fetchpriority="high" />
```

- l'image du hero : `loading="eager"` + `fetchpriority="high"` — c'est
  l'élément LCP
- toutes les autres : `loading="lazy"`
- `public/` reste pour ce qui doit garder son URL exacte : `robots.txt`,
  `favicon.ico`, un fichier de vérification.

## Aperçu

Un aperçu s'ouvre sur l'**URL réelle** de la page — `/tarifs?t=<jeton>` —
jamais sur une route `/preview/...` parallèle. Ce qu'un éditeur contrôle
avant publication est donc littéralement la page qui partira en ligne.

Le jeton est vérifié **deux fois** : l'HMAC dans Astro avant tout appel
réseau, puis à nouveau dans Convex (invariant 2 de `CLAUDE.md`). Ne jamais
retirer l'une des deux au motif que l'autre suffit.

## À ne jamais faire

- Réintroduire un corps de page en base (Markdown, blocs, champs de texte).
  Une page n'a pas de `body`. `renderMarkdown` est pour les **articles**
  (`posts.body`), pas pour les pages.
- Appeler une query Convex qui ne filtre pas `status === "published"`.
  `apps/web` n'a ni session ni clé admin. L'aperçu passe par
  `pages.previewPage` et le jeton HMAC, jamais par une query publique
  relâchée.
- Recréer une route attrape-tout `[...slug].astro`. Elle a existé et a été
  supprimée avec le modèle de contenu qu'elle servait.
- Ajouter un bandeau d'aperçu ou un ternaire `{page === null ? …}` dans
  le fichier de page. Les deux sont dans `BaseLayout`.

## Vérifier

```bash
PUBLIC_CONVEX_URL=http://127.0.0.1:3210 pnpm --filter @astrotan/web build
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/<slug>
```

Le build est le contrôle qui compte : un `.ts` égaré sous `src/pages/`
devient une route et casse `astro build` alors que les tests restent verts.

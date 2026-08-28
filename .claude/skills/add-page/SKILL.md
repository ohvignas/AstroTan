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
| Sur quel chemin répond-elle ? | l'admin (`slug`) |
| Qui doit la trouver ? | l'admin (`seo`, `geo`) |
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
import PageHead from "../components/PageHead.astro"
const { page } = await loadPage(Astro, "<slug>")
```

`loadPage` fait tout le reste : la recherche publiée, l'aperçu par `?t=`, le
statut 404, et les tags de cache. `PageHead` rend le titre, la description,
le canonique, `robots`, l'Open Graph et les champs GEO.

Prendre `apps/web/src/pages/contact.astro` comme modèle minimal.

### 2. Rendre le 404 et le contenu séparément

```astro
{page === null ? (
  <main>…404…</main>
) : (
  <main>…votre page…</main>
)}
```

Servir le balisage avec un statut 404 est incohérent : le corps et le statut
doivent dire la même chose.

### 3. Créer la ligne dans l'admin

Même slug, puis **publier**. Tant qu'elle est en brouillon, la route répond
404 — c'est l'invariant, pas un défaut.

Le nom du fichier et le slug sont identiques, sauf pour l'accueil :
`index.astro` sert `/`, qui n'a pas de segment à nommer.

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

- Rendre du contenu venu de la base sans passer par `renderMarkdown`
  (`lib/markdown.ts`). Il assainit **après** le rendu, jamais avant : Markdown
  laisse passer le HTML brut par conception, donc « ce n'est que du Markdown »
  n'est pas une propriété de sécurité.
- Appeler une query Convex qui ne filtre pas `status === "published"`.
  `apps/web` n'a ni session ni clé admin.
- Recréer une route attrape-tout `[...slug].astro`. Elle a existé et a été
  supprimée avec le modèle de contenu qu'elle servait.

## Vérifier

```bash
PUBLIC_CONVEX_URL=http://127.0.0.1:3210 pnpm --filter @astrotan/web build
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/<slug>
```

Le build est le contrôle qui compte : un `.ts` égaré sous `src/pages/`
devient une route et casse `astro build` alors que les tests restent verts.

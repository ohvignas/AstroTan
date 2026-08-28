# AstroTan

Template site vitrine + CMS. Site public Astro, dashboard TanStack Start, backend
Convex partagé, Docker sur VPS Hostinger derrière Traefik.

**Spec d'architecture : [`docs/superpowers/specs/2026-08-27-astrotan-design.md`](docs/superpowers/specs/2026-08-27-astrotan-design.md)** — à lire avant toute
décision technique. Elle contient le schéma de données, les invariants de sécurité,
la stratégie de cache et la procédure de rollback.

## Structure

```
apps/web/          Astro 7 · @astrojs/node standalone · une page = un .astro
apps/admin/        TanStack Start 1 · React 19 · shadcn/ui
packages/backend/  Convex : schema, functions, betterAuth/ (Local Install)
packages/tokens/   tokens Tailwind v4 partagés
docker/            Dockerfiles · compose Traefik · config statique Traefik
```

**Ajouter une page**, c'est écrire `apps/web/src/pages/<slug>.astro`. Les trois
lignes à recopier en tête — et il n'y a rien d'autre à brancher :

```astro
export const prerender = false
import { loadPage } from "../lib/loadPage"
import PageHead from "../components/PageHead.astro"
const { page } = await loadPage(Astro, "<slug>")
```

pnpm workspaces + Turborepo. Les types viennent de la codegen Convex : lancer
`convex codegen` avant un typecheck à froid, sinon `_generated` manque.

## Invariants — à ne jamais casser

1. **`apps/web` n'a ni clé admin Convex ni session.** Il n'appelle que des queries
   publiques, et chacune filtre `status === "published"` côté serveur. Une query
   publique sans ce filtre est une fuite de brouillons.
2. **Les queries de preview sont une famille de fonctions distincte** des queries
   publiques, protégées par un token HMAC expirable vérifié deux fois : dans Astro
   (`lib/loadPage.ts`, avant tout appel réseau), puis à nouveau dans Convex
   (`pages.previewPage`). Le jeton signe le **slug**, si bien que l'aperçu
   s'ouvre à la vraie URL de la page (`/accueil?t=…`) — jamais une route
   parallèle qui en rendrait une approximation.
3. **Les permissions sont revérifiées dans chaque mutation Convex.** L'UI masque,
   elle ne décide pas.
4. **Le rôle vit sur l'utilisateur Better Auth**, jamais dupliqué côté application.
5. **La base ne porte aucun contenu de page.** Une page *est* son fichier
   `.astro` : le balisage, la mise en page et les mots, écrits en code depuis
   une maquette. La ligne `pages` ne porte que le slug, le titre, le statut,
   `seo` et `geo`. Trois modèles de contenu ont été essayés puis retirés
   (union de blocs, corps Markdown, champs de texte déclarés) — chacun était
   une seconde façon, plus faible, de faire ce que le code fait déjà.
   L'admin décide **qui doit trouver la page**, jamais ce qu'elle contient.
6. **Aucun changement de schéma destructif dans un seul déploiement.** Discipline
   expand / migrate / contract (spec §7) — c'est ce qui rend le rollback sûr.
7. **Le rollback rejoue le pipeline entier sur un sha.** Jamais les images seules :
   `convex deploy` a déjà remplacé functions et schéma (spec §7). Procédure :
   [`docker/README.md`](docker/README.md).

## Règles du backend Convex — apprises à la dure

**Tout fichier à nom simple sous `packages/backend/convex/` est un point d'entrée de
déploiement.** Le bundler Convex l'analyse au push. Seuls les noms à deux points
(`*.test.ts`) en sont exclus.

Conséquences, chacune payée une fois :

1. **Les helpers de test vivent hors de `convex/`**, dans `packages/backend/testing/`.
   Une fixture placée sous `convex/` a cassé le déploiement avec
   `TypeError: import.meta unsupported` — supporté par vitest, refusé par le runtime
   Convex. Les tests étaient verts et le typecheck propre.
2. **`tsc` et vitest ne voient pas ce que le runtime Convex refuse.** Après toute
   modification de `convex/`, lancer un `npx convex dev --once` réel avant de
   considérer la tâche finie.
3. **`convex/_generated/` est committé et doit être régénéré, jamais édité à la main.**
   Il avait dérivé de trois modules avant qu'on s'en aperçoive. Une édition manuelle
   qui « a l'air juste » diverge en silence.
4. **Les composants Convex ont un environnement isolé.** Les variables posées sur le
   déploiement de l'app ne sont pas visibles depuis un composant.
5. **`convex dev` exige un terminal interactif.** Le mode anonyme local
   (« Start without an account ») évite toute authentification de compte.

## Outillage

### Serveurs MCP (`.mcp.json`)

| Serveur | Usage |
|---|---|
| `astro-docs` | doc Astro — **seule source**, Astro ne publie pas de `llms.txt` |
| `convex-docs` | doc Convex |
| `convex` | déploiement Convex du projet : tables, données, exécution de functions |
| `better-auth` | doc Better Auth (`search_docs` puis `get_doc`) |
| `shadcn` | recherche et installation de composants shadcn/ui |
| `playwright` | tests E2E et vérification visuelle |

Ils demandent une approbation au premier lancement de la session.

### Skills

Les skills locaux (`.claude/skills/`) portent les erreurs réellement commises
dans ce dépôt, pas des bonnes pratiques générales. Les lire avant d'écrire :

| Sujet | Skill |
|---|---|
| Ajouter / modifier une page du site | `add-page` (local) |
| Écrire une query, mutation, table ou index Convex | `convex-function` (local) |
| Intégrer une maquette HTML, performance, images, polices | `mockup-to-astro` (local) |
| Better Auth × Convex | `better-auth` (local) |
| Convex | `convex`, `convex-setup-auth`, `convex-migration-helper` |
| shadcn/ui et blocs UI | `shadcnblocks` |
| SEO / GEO | `anthropic-skills:seo-geo`, `schema-markup`, `seo-audit` |

### Références vendorisées

`docs/ai/` contient les `llms.txt` de Convex, Better Auth, TanStack Start et shadcn.
Ce sont des **index**, pas la doc complète. Rafraîchir avec
`./scripts/refresh-ai-docs.sh`.

## Amorcer du contenu de démonstration

```bash
cd packages/backend && npx convex run seed:demoContent
```

Crée deux tags, deux pages publiées et trois articles — dont un brouillon,
pour que l'invariant « un brouillon n'est jamais public » soit visible plutôt
qu'affirmé. Idempotent par slug : le relancer ne change rien, et il saute
toute ligne existante. Tout ce qu'il écrit est destiné à être supprimé depuis
l'administration.

C'est un `internalMutation` : il écrit par `ctx.db` sans session, parce qu'un
opérateur qui lance une commande CLI n'en a pas. Il contourne donc les
contrôles de rôle — acceptable pour une commande qui exige déjà la clé de
déploiement, et c'est la raison pour laquelle il n'est pas une `mutation`
publique.

## Écosystème TanStack — ce qu'on utilise, et ce qu'on refuse

Le dashboard s'appuie sur **Start**, **Router**, **Devtools**, `router-plugin`
et `eslint-config`. Le reste du catalogue est écarté, et deux de ces refus
sont importants :

- **TanStack Query : à ne jamais ajouter.** Convex *est* la couche de
  données réactive — `useQuery` de `convex/react` ouvre un abonnement et le
  serveur pousse les mises à jour. Empiler Query par-dessus, c'est mettre un
  second cache devant un système qui invalide déjà tout seul : deux sources
  de vérité sur la fraîcheur, et des incohérences qu'on ne sait plus
  attribuer. Même raisonnement pour **TanStack DB**.
- **TanStack Store** : rien à partager entre composants qui ne soit déjà
  dans Convex ou dans l'état de route.

Deux valent d'être adoptées quand le besoin se présentera, et le besoin
approche :

- **TanStack Table** — les listes (utilisateurs, pages, bientôt médias et
  articles) sont des `<table>` écrites à la main. Tri, filtrage et
  pagination arrivent avec la médiathèque.
- **TanStack Form** — chaque formulaire de l'admin réimplémente validation,
  état « modifié » et état de soumission avec des `useState`. C'est le gain
  le plus net, et le plus répété.

**TanStack Charts** est l'outil du lot 6 (statistiques Umami par page).

## Versions

**Non épinglées tant que le spike d'intégration n'est pas vert** (spec §9). Le
couple `better-auth` / `@convex-dev/better-auth` est le point sensible. Ne pas
écrire d'API de cette stack de mémoire : Astro 7, TanStack Start 1 et
`@convex-dev/better-auth` bougent vite. Vérifier via MCP.

## Conventions

- TDD : test qui échoue, implémentation minimale, test qui passe, commit.
- Commits en anglais, format Conventional Commits.
- Le reste des échanges se fait en français.

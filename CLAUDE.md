# AstroTan

Template site vitrine + CMS. Site public Astro, dashboard TanStack Start, backend
Convex partagé, Docker sur VPS Hostinger derrière Traefik.

**Spec d'architecture : [`docs/superpowers/specs/2026-08-27-astrotan-design.md`](docs/superpowers/specs/2026-08-27-astrotan-design.md)** — à lire avant toute
décision technique. Elle contient le schéma de données, les invariants de sécurité,
la stratégie de cache et la procédure de rollback.

## Structure

```
apps/web/          Astro 7 · @astrojs/node standalone · SSG + SSR sélectif
apps/admin/        TanStack Start 1 · React 19 · shadcn/ui
packages/backend/  Convex : schema, functions, betterAuth/ (Local Install)
packages/tokens/   tokens Tailwind v4 partagés
docker/            Dockerfiles · compose · Traefik
```

pnpm workspaces + Turborepo. Les types viennent de la codegen Convex : lancer
`convex codegen` avant un typecheck à froid, sinon `_generated` manque.

## Invariants — à ne jamais casser

1. **`apps/web` n'a ni clé admin Convex ni session.** Il n'appelle que des queries
   publiques, et chacune filtre `status === "published"` côté serveur. Une query
   publique sans ce filtre est une fuite de brouillons.
2. **Les queries de preview sont une famille de fonctions distincte** des queries
   publiques, protégées par un token HMAC expirable vérifié deux fois : dans Astro,
   puis à nouveau dans Convex.
3. **Les permissions sont revérifiées dans chaque mutation Convex.** L'UI masque,
   elle ne décide pas.
4. **Le rôle vit sur l'utilisateur Better Auth**, jamais dupliqué côté application.
5. **Les blocs sont rendus uniquement en `.astro`.** Ne pas créer de version React
   d'un bloc : le dashboard édite des formulaires et prévisualise en `<iframe>`.
6. **Aucun changement de schéma destructif dans un seul déploiement.** Discipline
   expand / migrate / contract (spec §7) — c'est ce qui rend le rollback sûr.

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

| Sujet | Skill |
|---|---|
| Better Auth × Convex | `better-auth` (local, `.claude/skills/`) |
| Convex | `convex`, `convex-setup-auth`, `convex-migration-helper` |
| shadcn/ui et blocs UI | `shadcnblocks` |
| SEO / GEO | `anthropic-skills:seo-geo`, `schema-markup`, `seo-audit` |

### Références vendorisées

`docs/ai/` contient les `llms.txt` de Convex, Better Auth, TanStack Start et shadcn.
Ce sont des **index**, pas la doc complète. Rafraîchir avec
`./scripts/refresh-ai-docs.sh`.

## Versions

**Non épinglées tant que le spike d'intégration n'est pas vert** (spec §9). Le
couple `better-auth` / `@convex-dev/better-auth` est le point sensible. Ne pas
écrire d'API de cette stack de mémoire : Astro 7, TanStack Start 1 et
`@convex-dev/better-auth` bougent vite. Vérifier via MCP.

## Conventions

- TDD : test qui échoue, implémentation minimale, test qui passe, commit.
- Commits en anglais, format Conventional Commits.
- Le reste des échanges se fait en français.

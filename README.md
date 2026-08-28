# AstroTan

Template pour livrer un site vitrine et son back-office : un site public Astro,
un dashboard de gestion, un backend Convex partagé, et le déploiement complet
qui va avec — Docker sur un VPS derrière Traefik, CI/CD GitHub Actions, HTTPS
automatique, rollback en une commande.

Ce n'est pas un page-builder. **Une page est un fichier `.astro`**, écrit en
code. Le dashboard décide qui la voit, quand elle est publiée, et ce que les
moteurs de recherche en comprennent — jamais ce qu'elle contient. Ce choix est
délibéré : trois modèles de contenu en base ont été essayés puis retirés
(`CLAUDE.md`, invariant 5).

| | Site public | Dashboard |
|---|---|---|
| Framework | Astro 7 · `@astrojs/node` standalone | TanStack Start 1 · React 19 |
| Rendu | SSG + SSR sélectif, cache par tags | SPA/SSR authentifié |
| Auth | aucune | Better Auth, trois rôles |
| Accès Convex | queries publiques uniquement | session |

## Mise en service

**Si un agent (Claude Code, Cursor, Codex…) installe ce template : lisez
[`AGENTS.md`](AGENTS.md).** Il contient les commandes réelles, les huit étapes
d'amorçage dans l'ordre, les invariants et les pièges d'environnement.

Pour un humain, l'ordre est le même :

1. Créer le déploiement Convex et poser ses variables — [`packages/backend/.env.example`](packages/backend/.env.example)
2. Copier les `.env.example` des deux applications, lancer `pnpm dev`
3. Amorcer le VPS, le DNS, GHCR et les secrets GitHub — [`docker/README.md`](docker/README.md)

Chaque `.env.example` documente, variable par variable : à quoi elle sert, où
trouver la valeur, si c'est un secret, et ce qui casse si elle est fausse.
Aucune n'a de valeur par défaut utilisable telle quelle — les placeholders
sont manifestement faux, exprès.

## Développement

```bash
corepack enable && pnpm install
pnpm dev          # site sur :4321, dashboard sur :3001
pnpm test
pnpm typecheck
```

Le backend Convex a besoin d'un déploiement en fonctionnement : `npx convex dev`
depuis `packages/backend`, dans un vrai terminal (la commande est interactive).

## Structure

```
apps/web/          site public Astro — une page = un .astro
apps/admin/        dashboard TanStack Start
packages/backend/  Convex : schéma, functions, Better Auth (Local Install)
packages/tokens/   tokens Tailwind v4 partagés par les deux applications
docker/            images, compose Traefik, runbook d'exploitation
```

## Documentation

| Fichier | Contenu |
|---|---|
| [`AGENTS.md`](AGENTS.md) | point d'entrée des agents de code : commandes, amorçage, invariants |
| [`CLAUDE.md`](CLAUDE.md) | conventions, invariants détaillés, règles Convex apprises à la dure |
| [`docker/README.md`](docker/README.md) | VPS, DNS, certificats, secrets, déploiement, rollback |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | spec d'architecture : modèle de données, sécurité, cache, rollback |
| [`docs/superpowers/plans/`](docs/superpowers/plans/) | plans d'implémentation, lot par lot |

## Ce que le template ne fait pas

Multilingue, révisions et historique, page-builder glisser-déposer,
multi-tenant, formulaires de contact, recherche. Le déploiement n'est pas non
plus sans coupure : quelques secondes de 502 à chaque mise à jour, assumées et
expliquées dans [`docker/README.md`](docker/README.md).

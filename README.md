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

Pour un humain, tout ce qui peut être automatisé l'est par une commande :

```bash
corepack enable && pnpm install
pnpm bootstrap --dry-run     # crée .env.deploy, puis montre ce qui serait fait
$EDITOR .env.deploy          # le SEUL fichier que vous remplissez
pnpm bootstrap               # distribue
```

Vous remplissez [`.env.deploy`](.env.deploy.example) — domaines, email ACME,
dépôt et propriétaire GHCR, URLs et clé de déploiement Convex, accès SSH du
VPS, clé Resend. Le script en distribue les valeurs vers les trois
destinations qui ne peuvent pas se lire entre elles :

| Destination | Ce qui y est posé |
|---|---|
| déploiement Convex | les 7 variables de [`packages/backend/.env.example`](packages/backend/.env.example), par `convex env set` |
| secrets GitHub Actions | les 9 secrets de [`docker/README.md`](docker/README.md) §7, par `gh secret set` |
| développement local | `apps/web/.env` et `apps/admin/.env` |

Il génère au passage `BETTER_AUTH_SECRET`, `PREVIEW_SECRET` et
`REVALIDATE_SECRET` — une fois, puis les relit tels quels — et produit
`.env.vps`, le bloc à copier dans `~/astrotan/.env` sur le VPS. Il n'affiche
jamais la valeur d'un secret, et `--dry-run` n'écrit ni n'appelle rien.

Restent à votre charge, parce qu'ils n'ont rien d'automatisable : le DNS, la
visibilité des packages GHCR, le premier essai sur le CA de staging de Let's
Encrypt, et le premier déploiement. Le script les rappelle en fin
d'exécution avec la section correspondante de [`docker/README.md`](docker/README.md),
**qui reste la référence** — et la marche à suivre entière pour qui n'a ni
`gh` ni Node sous la main.

Chaque `.env.example` documente, variable par variable : à quoi elle sert, où
trouver la valeur, si c'est un secret, et ce qui casse si elle est fausse.
Aucune n'a de valeur par défaut utilisable telle quelle — les placeholders
sont manifestement faux, exprès, et `pnpm bootstrap` refuse de les distribuer.

## Développement

```bash
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
| [`.env.deploy.example`](.env.deploy.example) | le seul fichier à remplir ; `pnpm bootstrap` en distribue les valeurs |
| [`docker/README.md`](docker/README.md) | VPS, DNS, certificats, secrets, déploiement, rollback |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | spec d'architecture : modèle de données, sécurité, cache, rollback |
| [`docs/superpowers/plans/`](docs/superpowers/plans/) | plans d'implémentation, lot par lot |

## Ce que le template ne fait pas

Multilingue, révisions et historique, page-builder glisser-déposer,
multi-tenant, formulaires de contact, recherche. Le déploiement n'est pas non
plus sans coupure : quelques secondes de 502 à chaque mise à jour, assumées et
expliquées dans [`docker/README.md`](docker/README.md).

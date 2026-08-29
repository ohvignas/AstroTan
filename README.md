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
[`AGENTS.md`](AGENTS.md).** Il contient les commandes réelles, les invariants
et les pièges d'environnement.

Le parcours complet, du clone au premier écran, tient en six étapes — et les
trois du milieu sont une seule commande.

**1. Créer le déploiement Convex.** Depuis `packages/backend`, dans un vrai
terminal (`npx convex dev` est interactive, un agent ne peut pas la lancer).
Noter les deux URLs, `*.convex.cloud` et `*.convex.site`, puis générer une
clé de déploiement de production (*Settings → Deploy keys*).

**2. Remplir un fichier, lancer une commande.**

```bash
corepack enable && pnpm install
pnpm bootstrap --dry-run     # crée .env.deploy, puis montre ce qui serait fait
$EDITOR .env.deploy          # le SEUL fichier que vous remplissez
pnpm bootstrap               # distribue
```

Vous remplissez [`.env.deploy`](.env.deploy.example) — domaines, email ACME,
adresse du premier compte, dépôt et propriétaire GHCR, URLs et clé de
déploiement Convex, accès SSH du VPS, clé Resend. Le script en distribue les
valeurs vers les trois destinations qui ne peuvent pas se lire entre elles :

| Destination | Ce qui y est posé |
|---|---|
| déploiement Convex | les variables de [`packages/backend/.env.example`](packages/backend/.env.example), par `convex env set` |
| secrets GitHub Actions | les secrets de [`docker/README.md`](docker/README.md) §7, par `gh secret set` |
| développement local | `apps/web/.env.local` et `apps/admin/.env.local` |

Il génère au passage les dix secrets que personne ne choisit à la main —
le secret de session, les quatre clés HMAC, la clé maîtresse `SECRETS_KEY`,
les trois secrets Umami — une fois, puis les relit tels quels, et produit
`.env.vps`, le bloc à copier dans `~/astrotan/.env` sur le VPS. Il n'affiche
jamais la valeur d'un secret, et `--dry-run` n'écrit ni n'appelle rien.

**3. Ce que le script ne peut pas faire.** Il les rappelle en fin
d'exécution, chacun avec sa section de [`docker/README.md`](docker/README.md),
**qui reste la référence** : la visibilité des packages GHCR, le DNS, la
copie de `.env.vps` sur le VPS, et le premier essai sur le CA de *staging*
de Let's Encrypt (5 certificats par 7 jours en production, sans remise à
zéro possible).

**4. Premier déploiement.** Pousser sur `main` et regarder le workflow
*Deploy*. C'est lui qui lance `convex deploy`, donc lui qui met les
functions sur le déploiement.

**5. Relancer `pnpm bootstrap`, une fois.** Rien à modifier, rien à
ressaisir : le script est rejouable et ne repose aucun secret. Ce second
passage fait les deux choses qui exigeaient que les functions existent, et
sans lesquelles un déploiement dont tous les conteneurs sont `healthy`
reste inutilisable :

- il crée les lignes `pages` — **sans elles, toutes les URL du site
  répondent 404**, y compris `/`. Une page est un couple : son fichier
  `.astro` *et* sa ligne ;
- il émet l'invitation du premier compte, en rôle `owner`. L'accès au
  dashboard est sur invitation seule : **sans elle, personne n'entre**,
  pas même vous.

**6. Ouvrir le lien `…/accept-invite?token=…`** que le script vient
d'afficher, et choisir son mot de passe sur la page normale. Aucun mot de
passe ne passe par le script, le shell, ou un historique. Les comptes
suivants s'invitent depuis le dashboard.

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

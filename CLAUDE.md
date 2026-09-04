# AstroTan

Template site vitrine + CMS. Site public Astro, dashboard TanStack Start, backend
Convex partagé, Docker sur un VPS derrière Traefik.

**Spec d'architecture : [`docs/superpowers/specs/2026-08-27-astrotan-design.md`](docs/superpowers/specs/2026-08-27-astrotan-design.md)** — à lire avant toute
décision technique. Elle contient le schéma de données, les invariants de sécurité,
la stratégie de cache et la procédure de rollback.

[`AGENTS.md`](AGENTS.md) est la version courte destinée aux agents tiers qui ne
lisent pas ce fichier (Cursor, Codex, Copilot, Gemini CLI, Zed…) : commandes,
mise en service pas à pas, pièges d'environnement. Ce fichier-ci reste la
référence détaillée — modifier l'un sans l'autre les fait diverger.

## Ce dépôt est un template, pas une application

**Personne ne « déploie AstroTan ». Des gens l'installent, chacun chez eux** —
leur déploiement Convex, leur dépôt GitHub, leurs domaines, leur VPS. Ce
cadrage prime sur le reste de ce fichier : il change ce qu'« avoir fini »
veut dire.

Sur une application, un geste manuel se fait une fois. Ici, **chaque geste
manuel non guidé sera refait par chaque installateur — et raté par
plusieurs**. Une fonctionnalité livrée avec « il suffit de lancer telle
commande » n'est pas livrée : elle est en attente, et elle attendra chez
tout le monde en même temps.

Une tâche n'est donc close que si le câblage vit à l'un de ces endroits :

| Mécanisme | Quand c'est le bon |
|---|---|
| `scripts/bootstrap.mjs` | la valeur peut être **générée** (`openssl rand`) ou **demandée** une fois |
| `scripts/check-env-wiring.mjs` | le câblage a plusieurs maillons et l'un peut disparaître |
| un échec de build | la valeur est figée AU BUILD et une valeur absente ou malformée doit arrêter là |
| un refus au démarrage du conteneur | la divergence n'apparaît qu'au runtime — l'échec tombe pendant le déploiement, où le rollback existe |
| un écran d'administration | la valeur est propre à l'installateur et se change après coup |

Une ligne de README n'est dans aucune de ces cases. Elle documente un
câblage ; elle n'en est pas un.

**Le cas qui reste manuel par nature** — les mentions légales, le registre
des traitements, la raison sociale — n'échappe pas à la règle, il la
déplace : ce n'est pas une page de documentation qui le tient, c'est un
garde-fou qui **empêche de publier les valeurs d'exemple**. Un site mis en
ligne avec AstroTan comme responsable de traitement est un défaut du
template, pas une erreur de l'installateur.

Corollaire pour les relectures : une liste de « ce qu'il reste à faire à la
main » adressée à l'humain est presque toujours le symptôme d'un défaut de
câblage, pas d'une documentation à écrire.

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
7. **Un secret ne vit qu'à trois endroits, et jamais ailleurs** : une
   `PUBLIC_*` figée AU BUILD (donc visible de tous), un `process.env` du
   conteneur lu au runtime, ou l'environnement Convex. Un jeton saisi depuis
   l'administration est chiffré avec une clé maîtresse qui, elle, vit dans
   l'environnement Convex — jamais en clair en base, et jamais dans la table
   `settings`, dont la query `get` est publique. Le raisonnement, ses
   sources et ce qu'on a refusé :
   [`docs/superpowers/specs/2026-08-29-secrets-et-chiffrement.md`](docs/superpowers/specs/2026-08-29-secrets-et-chiffrement.md).
8. **Le rollback rejoue le pipeline entier sur un sha.** Jamais les images seules :
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
| **Consentement, cookies, RGPD, pixels** | `consent-rgpd` (local) |
| **Déploiement, rollback, secrets du VPS** | `deploy-vps` (local) |
| Convex | `convex`, `convex-setup-auth`, `convex-migration-helper` |
| shadcn/ui et blocs UI | `shadcnblocks` |
| SEO / GEO | `anthropic-skills:seo-geo`, `schema-markup`, `seo-audit` |
| **Umami / mesure d'audience** | `umami-setup` (local) — **le point d'entrée**, il route vers les autres |

### Références vendorisées

`docs/ai/` contient les `llms.txt` de Convex, Better Auth, TanStack Start et shadcn.
Ce sont des **index**, pas la doc complète. Rafraîchir avec
`./scripts/refresh-ai-docs.sh`.

## Amorcer un accès administrateur

L'accès au dashboard est sur invitation seule (`disableSignUp: true`, pas
d'OAuth), et émettre une invitation exige d'être déjà owner ou admin. Oublier
son propre mot de passe n'en fait plus partie : la personne le réinitialise
elle-même, sans passer par la CLI — à condition que l'envoi d'emails soit
réellement configuré (`RESEND_TEST_MODE=false`, voir `docker/README.md` §8 ;
tant que ce n'est pas fait, Resend accepte l'envoi et ne le délivre jamais).

Deux situations restent sans issue par l'interface : un déploiement neuf sans
aucun compte, et la perte de **tous** les accès owner/admin à la fois — perdre
un seul mot de passe n'y suffit plus.

**`pnpm bootstrap` le fait** — étape 7, une fois les functions déployées :
il lit `bootstrap:owners`, saute si un owner existe déjà, et rend sinon le
lien du premier compte. C'est le chemin normal, et le seul qui reste
rejouable. La commande n'est utile qu'à la main, pour le second cas (tous
les accès owner/admin perdus) :

```bash
cd packages/backend
npx convex run bootstrap:createInvitation '{"email":"vous@exemple.com","role":"owner"}'
```

Rend un jeton ; ouvrir `<admin>/accept-invite?token=<jeton>` et choisir son
mot de passe sur la page normale. **Aucun mot de passe ne transite par le
shell ni par un historique.**

Pour une vérif visuelle locale (agents) : `pnpm admin:dev-link` écrit le
même genre de lien dans `.local/admin-invite.url` (gitignoré, 0600). S'il
existe déjà un owner, le lien crée un **editor**, jamais un second owner.
Pas de jeton de reset exposé par `npx convex run` : après un premier login,
sauver la session Playwright dans `.local/admin-storage.json`.

**`"role":"owner"`, jamais `"admin"`.** `invitations.create` refuse
`role: "owner"` à *tout le monde* : un déploiement dont le premier compte
est `admin` n'aura donc **jamais** d'owner. Et un admin ne peut ni inviter
un autre admin, ni promouvoir, ni rétrograder, ni supprimer un admin
(`invitations.ts`, `users.setRole`, `users.remove`) — le déploiement reste
plafonné à un seul administrateur, sans issue par l'interface. Le
garde-fou `owners > 0` d'`auth.ts` n'autorise la création d'un owner que
tant qu'il n'en existe aucun : cette fenêtre-là ne se rouvre pas.

C'est un `internalMutation` : inatteignable depuis un client, seulement via
`npx convex run`, qui exige déjà les identifiants du déploiement. Quelqu'un
qui les détient peut de toute façon tout faire sur ce déploiement — ce
chemin n'élargit rien.

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
